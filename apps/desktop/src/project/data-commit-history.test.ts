import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commitDatasetEdits } from './data-save'
import { SetDatasetContentCommand } from '@desktop-webgis/project'
import { prepareFieldSchemaEdit } from '@/ui/panels/attribute-table/field-schema-edits'
import { calculateTableField, resolveDatasetFields } from '@/ui/panels/attribute-table/field-edits'
import { createProject, requireMapContent, UpdatePropertiesCommand } from '@desktop-webgis/project'
import { projectSession } from './project-session'
import { projectEdits } from './project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { useProjectStore } from '@/project/project.store'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { featureCommands } from '@/commands/feature.commands'
let a: string, b: string
beforeEach(() => {
  projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
  for (const id of ['a', 'b']) layerContentCommands.addLayer(id, id, [{ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }], 'point')
  const layers = requireMapContent(useProjectStore.getState().project).layers
  a = layers.find(layer => layer.datasetId === 'a')!.id; b = layers.find(layer => layer.datasetId === 'b')!.id
  projectEdits.clear()
})
describe('acknowledged pure-row history barrier', () => {
  it('commits the actual field-calculator result as rows and declared schema', async () => {
    const features = featureData.getAll('a'), field = resolveDatasetFields(features, undefined).find(field => field.name === 'value')!
    const result = calculateTableField(features, undefined, field, 'field("value") * 3', new Set(['row']))
    projectEdits.execute(new SetDatasetContentCommand('calculate', 'Calculate', 'a', { features }, result))
    expect(await commitDatasetEdits('a', async () => {})).toBe(true)
    expect(featureData.getById('a', 'row')!.properties.value).toBe(3)
    expect(await featureData.readSourceFields('a')).toEqual(result.fields)
    expect(featureData.pendingCount('a')).toBe(0); expect(projectEdits.canUndo()).toBe(false)
  })

  it('commits a same-name schema declaration without retaining stale schema undo', async () => {
    const snapshot = projectSession.getSnapshot()
    requireMapContent(snapshot.project).datasets.find(dataset => dataset.id === 'a')!.fields = [{ name: 'value', type: 'number', nullable: true }]
    projectSession.applySnapshotAsEdit(snapshot, 'Declare schema')
    expect(featureData.pendingCount('a')).toBe(1)
    const write = vi.fn()
    expect(await commitDatasetEdits('a', write)).toBe(true)
    expect(write).toHaveBeenCalledTimes(1); expect(projectEdits.canUndo()).toBe(false)
    expect(featureData.pendingCount('a')).toBe(0)
    expect(await featureData.readSourceFields('a')).toEqual([{ name: 'value', type: 'number', nullable: true }])
  })
  it('commits an actual field-add command and retains independent layer configuration undo', async () => {
    layerConfigurationCommands.renameLayer(a, 'Alpha')
    const prepared = prepareFieldSchemaEdit(useProjectStore.getState().project, 'a', featureData.getAll('a'), {
      type: 'add', field: { name: 'code', type: 'string', nullable: true }, defaultValue: '001'
    })
    projectEdits.execute(new SetDatasetContentCommand('add-column', 'Add code', 'a', prepared.before, prepared.after, prepared.change))
    const project = useProjectStore.getState()
    let persisted: unknown
    expect(await commitDatasetEdits('a', async (features, _signal, fields) => { persisted = { features, fields } })).toBe(true)
    expect(persisted).toMatchObject({ features: [{ properties: { value: 1, code: '001' } }], fields: prepared.after.fields })
    expect(useProjectStore.getState()).toBe(project); expect(featureData.pendingCount('a')).toBe(0)
    expect(projectEdits.undo()).toBe(true); expect(projectEdits.canUndo()).toBe(false)
    expect(requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === a)!.name).toBe('a')
    expect(featureData.getById('a', 'row')!.properties).toEqual({ value: 1, code: '001' })
    expect(await featureData.readSourceFields('a')).toEqual(prepared.after.fields)
  })

  it('rebases two datasets in one mixed snapshot through independent commits', async () => {
    const snapshot = projectSession.getSnapshot()
    requireMapContent(snapshot.project).layers.find(layer => layer.id === a)!.name = 'Mixed'
    snapshot.featuresByDataset.a[0].properties.value = 9; snapshot.featuresByDataset.b[0].properties.value = 8
    projectSession.applySnapshotAsEdit(snapshot, 'Mixed sources')
    await commitDatasetEdits('a', async () => {}); await commitDatasetEdits('b', async () => {})
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.getById('a', 'row')!.properties.value).toBe(9); expect(featureData.getById('b', 'row')!.properties.value).toBe(8)
    expect(featureData.pendingCount()).toBe(0)
    expect(requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === a)!.name).toBe('a')
  })
  it('tracks contextual writes by an undeclared custom command and refuses an unsafe commit', async () => {
    projectEdits.execute({ id: 'custom', label: 'Custom', execute(context) {
      const row = context.featureStore.getById('a', 'row')!
      context.featureStore.update('a', { ...row, properties: { value: 9 } })
    }, undo(context) {
      const row = context.featureStore.getById('a', 'row')!
      context.featureStore.update('a', { ...row, properties: { value: 1 } })
    } })
    const write = vi.fn()
    await expect(commitDatasetEdits('a', write)).rejects.toThrow('schema-aware')
    expect(write).not.toHaveBeenCalled(); expect(projectEdits.undo()).toBe(true)
    featureData.setAll('a', featureData.getAll('a'))
    expect(projectEdits.redo()).toBe(false)
    expect(projectEdits.getBlockReason('redo')).toContain('数据源会话已替换')
  })

  it('retains independent configuration in mixed snapshots without replaying saved old rows', async () => {
    const snapshot = projectSession.getSnapshot()
    requireMapContent(snapshot.project).layers.find(layer => layer.id === a)!.name = 'Mixed'
    snapshot.featuresByDataset.a[0].properties.value = 9
    projectSession.applySnapshotAsEdit(snapshot, 'Mixed change')
    const project = useProjectStore.getState()
    expect(await commitDatasetEdits('a', async () => {})).toBe(true)
    expect(useProjectStore.getState()).toBe(project)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === a)!.name).toBe('a')
    expect(featureData.getById('a', 'row')!.properties.value).toBe(9); expect(featureData.pendingCount('a')).toBe(0)
    expect(projectEdits.redo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === a)!.name).toBe('Mixed')
    expect(featureData.getById('a', 'row')!.properties.value).toBe(9)
  })
  it('rejects schema-dependent history before invoking persistence and retains pending edits', async () => {
    projectEdits.execute(new SetDatasetContentCommand('schema', 'Schema', 'a', { features: featureData.getAll('a') }, {
      features: featureData.getAll('a').map(row => ({ ...row, properties: { renamed: 9 } })), fields: [{ name: 'renamed', type: 'number', nullable: true }]
    }))
    const write = vi.fn(), history = projectEdits.getState()
    await expect(commitDatasetEdits('a', write)).rejects.toThrow('schema-aware')
    expect(write).not.toHaveBeenCalled(); expect(projectEdits.getState()).toBe(history); expect(featureData.pendingCount('a')).toBe(2)
    expect(await featureData.readSourceFields('a')).toBeUndefined()
    expect(featureData.getEffectiveFields('a')).toEqual([{ name: 'renamed', type: 'number', nullable: true }])
    expect(projectEdits.undo()).toBe(true); expect(featureData.getById('a', 'row')!.properties).toEqual({ value: 1 })
    expect(featureData.pendingCount('a')).toBe(0); expect(featureData.getEffectiveFields('a')).toBeUndefined()
  })

  it('removes only the saved source row commands and preserves configuration and other data edits', async () => {
    layerConfigurationCommands.renameLayer(a, 'Alpha'); featureCommands.updateProperties(a, 'row', { value: 9 })
    layerConfigurationCommands.renameLayer(b, 'Beta'); featureCommands.updateProperties(b, 'row', { value: 8 })
    const project = useProjectStore.getState()
    const receipt = await featureData.saveDataset('a', async () => {})
    projectEdits.clearCommittedRows(receipt!)
    expect(useProjectStore.getState()).toBe(project)
    expect(projectEdits.undo()).toBe(true); expect(featureData.getById('b', 'row')!.properties.value).toBe(1)
    expect(projectEdits.undo()).toBe(true); expect(projectEdits.undo()).toBe(true); expect(projectEdits.canUndo()).toBe(false)
    expect(featureData.getById('a', 'row')!.properties.value).toBe(9); expect(featureData.pendingCount('a')).toBe(0)
    expect(() => projectEdits.clearCommittedRows(receipt!)).toThrow('not acknowledged')
  })
  it('retains the unsaved part of a cross-dataset batch in the same history', async () => {
    projectEdits.executeMany([new UpdatePropertiesCommand('a', 'a', 'row', { value: 1 }, { value: 9 }), new UpdatePropertiesCommand('b', 'b', 'row', { value: 1 }, { value: 8 })])
    const receipt = await featureData.saveDataset('a', async () => {}); projectEdits.clearCommittedRows(receipt!)
    expect(projectEdits.undo()).toBe(true); expect(featureData.getById('b', 'row')!.properties.value).toBe(1)
    expect(featureData.getById('a', 'row')!.properties.value).toBe(9); expect(projectEdits.canUndo()).toBe(false)
    expect(projectEdits.redo()).toBe(true); expect(featureData.getById('b', 'row')!.properties.value).toBe(8)
  })
  it('matches source identity rather than dataset ID across project replacement', async () => {
    featureCommands.updateProperties(a, 'row', { value: 9 })
    const next = projectSession.getSnapshot(); next.project.metadata.id = 'other'; next.featuresByDataset.a[0].properties.value = 20
    projectSession.replaceSnapshotAsEdit(next, 'Other'); featureCommands.updateProperties(a, 'row', { value: 30 })
    const receipt = await featureData.saveDataset('a', async () => {}); projectEdits.clearCommittedRows(receipt!)
    expect(projectEdits.undo()).toBe(true); expect(featureData.getById('a', 'row')!.properties.value).toBe(9)
    expect(featureData.pendingCount('a')).toBe(1)
    expect(projectEdits.undo()).toBe(true); expect(featureData.getById('a', 'row')!.properties.value).toBe(1)
    expect(projectEdits.redo()).toBe(true); expect(projectEdits.redo()).toBe(true)
    expect(featureData.getById('a', 'row')!.properties.value).toBe(30); expect(featureData.pendingCount('a')).toBe(0)
  })
  it('issues no empty-save receipt and rejects stale receipts without modifying either history branch', async () => {
    expect(await featureData.saveDataset('a', async () => {})).toBeUndefined()
    featureCommands.updateProperties(a, 'row', { value: 9 })
    const receipt = await featureData.saveDataset('a', async () => {})
    featureCommands.updateProperties(a, 'row', { value: 12 }); projectEdits.undo()
    const history = projectEdits.getState()
    expect(() => projectEdits.clearCommittedRows(receipt!)).toThrow('not acknowledged')
    expect(projectEdits.getState()).toBe(history); expect(projectEdits.canRedo()).toBe(true)
  })
})

describe('discard one source without clearing the history stack', () => {
  it('restores the source overlay and keeps other data and configuration undo', async () => {
    layerConfigurationCommands.renameLayer(a, 'Alpha')
    featureCommands.updateProperties(a, 'row', { value: 9 })
    featureCommands.updateProperties(b, 'row', { value: 8 })
    projectEdits.discardDatasetEdits('a')
    expect(featureData.getById('a', 'row')!.properties.value).toBe(1)
    expect(featureData.pendingCount('a')).toBe(0)
    expect(await featureData.readSource('a')).toEqual(featureData.getAll('a'))
    expect(featureData.getById('b', 'row')!.properties.value).toBe(8)
    expect(featureData.pendingCount('b')).toBe(1)
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.getById('b', 'row')!.properties.value).toBe(1)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === a)!.name).toBe('a')
    expect(projectEdits.canUndo()).toBe(false)
  })

  it('restores declared fields after discarding a field-add without a new undo step', async () => {
    layerConfigurationCommands.renameLayer(a, 'Alpha')
    const prepared = prepareFieldSchemaEdit(useProjectStore.getState().project, 'a', featureData.getAll('a'), {
      type: 'add', field: { name: 'code', type: 'string', nullable: true }, defaultValue: '001'
    })
    projectEdits.execute(new SetDatasetContentCommand('add-column', 'Add code', 'a', prepared.before, prepared.after, prepared.change))
    expect(featureData.getEffectiveFields('a')).toEqual(prepared.after.fields)
    projectEdits.discardDatasetEdits('a')
    expect(featureData.pendingCount('a')).toBe(0)
    expect(featureData.getById('a', 'row')!.properties).toEqual({ value: 1 })
    expect(featureData.getEffectiveFields('a')).toBeUndefined()
    expect(requireMapContent(useProjectStore.getState().project).datasets.find(dataset => dataset.id === 'a')!.fields).toBeUndefined()
    expect(requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === a)!.name).toBe('Alpha')
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === a)!.name).toBe('a')
    expect(projectEdits.canUndo()).toBe(false)
  })

  it('refuses unsupported mixed history before dropping the overlay', async () => {
    projectEdits.execute(new SetDatasetContentCommand('schema', 'Schema', 'a', { features: featureData.getAll('a') }, {
      features: featureData.getAll('a').map(row => ({ ...row, properties: { renamed: 9 } })), fields: [{ name: 'renamed', type: 'number', nullable: true }]
    }))
    const history = projectEdits.getState()
    expect(() => projectEdits.discardDatasetEdits('a')).toThrow('schema-aware')
    expect(projectEdits.getState()).toBe(history)
    expect(featureData.pendingCount('a')).toBe(2)
    expect(featureData.getById('a', 'row')!.properties).toEqual({ renamed: 9 })
  })
})
