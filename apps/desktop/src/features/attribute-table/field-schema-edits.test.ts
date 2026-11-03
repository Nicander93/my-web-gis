import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { featureData } from '@/data/feature-data'
import { selectionCommands } from '@/commands/selection.commands'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it } from 'vitest'
import { createProject, createDefaultLayerStyle, reconcileProjectCartography, SetDatasetContentCommand, type GisFeature, type Project } from '@desktop-webgis/project'
import { getFieldReferences, prepareFieldSchemaEdit, type FieldSchemaEdit } from './field-schema-edits'
import { useProjectStore } from '@/session/project.store'
import { useLayerViewStore } from '@/view-state/layer-view.store'
import { useWorkbenchStore } from '@/view-state/workbench.store'

const rows: GisFeature[] = [2, 4].map((value, index) => ({ id: `row-${index}`,
  geometry: { type: 'Point', coordinates: [116 + index, 39] }, properties: { value, code: '001' }, metadata: { sourceId: index } }))

function fixture(): Project {
  const project = createProject('Schema')
  requireMapContent(project).datasets = [{ id: 'data', name: 'Schema', kind: 'vector', source: { type: 'memory', label: 'Schema' } }]
  requireMapContent(project).layers = [{ id: 'first', name: 'First', datasetId: 'data', visible: true, editable: true, opacity: 1,
    style: { mode: 'categorized', field: 'value', categories: [{ value: 2, symbol: { type: 'circle', radius: 8 } }],
      fallback: { type: 'circle', radius: 5 }, label: { field: 'value', fontSize: 12 } },
    filter: [{ field: 'value', op: 'eq', value: 2 }], interaction: { selectable: false, popup: { titleField: 'value',
      fields: [{ field: 'value', label: '人口', format: 'number' }, { field: 'code', format: 'text' }] } } },
    { id: 'second', name: 'Second', datasetId: 'data', visible: false, editable: true, opacity: 0.4,
      style: createDefaultLayerStyle('point'), filter: [{ field: 'value', op: 'gt', value: 0 }] }]
  return project
}

function command(edit: FieldSchemaEdit) {
  const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
  const result = prepareFieldSchemaEdit(state.project, 'data', stateFeatureData.data, edit)
  return new SetDatasetContentCommand('schema', '字段编辑', 'data', result.before, result.after, result.change)
}

function advancedProject(): Project {
  const project = reconcileProjectCartography(fixture())
  const circle = requireMapContent(project).cartography?.styleLayers.find((layer) => layer.type === 'circle')
  if (!circle || circle.type !== 'circle') throw new Error('fixture did not create a circle style layer')
  circle.paint = { ...circle.paint, 'circle-color': [
    'case', ['boolean', ['has', 'value'], false], ['to-string', ['get', 'value']], '#123456'
  ] as never }
  return project
}

describe('dataset field schema transactions', () => {
  beforeEach(() => projectSession.loadSnapshot({ project: fixture(), featuresByDataset: { data: rows } }))

  it('validates duplicate/reserved names and default constraints before touching data, including empty datasets', () => {
    const before = projectSession.getSnapshot()
    const project = before.project
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'rename', from: 'value', to: 'code' })).toThrow(/已存在/)
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'add', field: { name: '__proto__', type: 'number', nullable: true }, defaultValue: 0 })).toThrow(/保留/)
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'add', field: { name: 'empty', type: 'number', nullable: false }, defaultValue: null })).toThrow(/空值/)
    expect(projectSession.getSnapshot()).toEqual(before)
    const result = prepareFieldSchemaEdit(project, 'data', [], { type: 'add', field: { name: 'count', type: 'number', nullable: false }, defaultValue: 0 })
    expect(result.after.features).toEqual([])
    expect(result.after.fields).toEqual([{ name: 'count', type: 'number', nullable: false }])
  })

  it('renames all shared-layer references and table drafts as one undo while preserving unrelated state', () => {
    const before = projectSession.getSnapshot()
    useWorkbenchStore.getState().bindTable('first'); useWorkbenchStore.getState().bindTable('second')
    useLayerViewStore.getState().setAttributeTableState('second', { sortField: 'value', statsField: 'value', hiddenFields: ['value'],
      fieldOrder: ['value', 'code'], scrollTop: 72, searchQuery: '001', filterDraft: [{ field: 'value', op: 'lt', value: 10 }] })
    selectionCommands.setSelection({ layerId: 'first', featureIds: ['row-0'] })
    projectEdits.execute(command({ type: 'rename', from: 'value', to: 'population' }))
    const next = useProjectStore.getState(), nextFeatureData = featureData.readSnapshot()
    expect(nextFeatureData.data.map((row) => row.properties)).toEqual([{ population: 2, code: '001' }, { population: 4, code: '001' }])
    expect(nextFeatureData.data.map((row) => ({ id: row.id, geometry: row.geometry, metadata: row.metadata })))
      .toEqual(rows.map((row) => ({ id: row.id, geometry: row.geometry, metadata: row.metadata })))
    expect(requireMapContent(next.project).layers[0].filter?.[0].field).toBe('population')
    expect(requireMapContent(next.project).layers[1].filter?.[0].field).toBe('population')
    expect(requireMapContent(next.project).layers[0].interaction?.popup).toEqual({ titleField: 'population', fields: [
      { field: 'population', label: '人口', format: 'number' }, { field: 'code', format: 'text' }] })
    expect(requireMapContent(next.project).layers[0].style).toMatchObject({ field: 'population', label: { field: 'population' } })
    expect(useLayerViewStore.getState().selection.featureIds).toEqual(['row-0'])
    expect(useLayerViewStore.getState().sessions.second.attributeTable).toMatchObject({ sortField: 'population', statsField: 'population',
      hiddenFields: ['population'], fieldOrder: ['population', 'code'], filterDraft: [{ field: 'population', op: 'lt', value: 10 }], scrollTop: 72, searchQuery: '001' })
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.canUndo()).toBe(false)
    expect(useLayerViewStore.getState().sessions.second.attributeTable?.sortField).toBe('value')
    expect(projectEdits.redo()).toBe(true)
    expect(useWorkbenchStore.getState().tableLayerIds).toEqual(['first', 'second'])
  })

  it('blocks referenced deletion, explicitly clears configurations, and restores them with their values on undo', () => {
    const before = projectSession.getSnapshot()
    expect(() => command({ type: 'remove', name: 'value', clearReferences: false })).toThrow(/仍被引用/)
    expect(projectEdits.canUndo()).toBe(false)
    projectEdits.execute(command({ type: 'remove', name: 'value', clearReferences: true }))
    const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
    expect(requireMapContent(state.project).layers[0].style).toEqual({ mode: 'single', symbol: { type: 'circle', radius: 5 } })
    expect(requireMapContent(state.project).layers.map((layer) => layer.filter)).toEqual([[], []])
    expect(requireMapContent(state.project).layers[0].interaction).toEqual({ selectable: false, popup: { fields: [{ field: 'code', format: 'text' }] } })
    expect(stateFeatureData.data.map((row) => row.properties)).toEqual([{ code: '001' }, { code: '001' }])
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
  })

  it('keeps immediate style edits in the same history as field schema edits', () => {
    layerConfigurationCommands.setLayerStyle('second', { mode: 'single', symbol: { type: 'circle', radius: 10 } })
    const before = projectSession.getSnapshot()
    projectEdits.execute(command({ type: 'rename', from: 'value', to: 'population' }))
    expect(projectEdits.getBlockReason('undo')).toBeNull()
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers[1].style).not.toEqual(requireMapContent(before.project).layers[1].style)
  })

  it('finds nested references in standard style ASTs and preserves unrelated AST when renaming and undoing', () => {
    const project = advancedProject()
    projectSession.loadSnapshot({ project, featuresByDataset: { data: rows } })
    const references = getFieldReferences(project, requireMapContent(project).layers.filter((layer) => layer.datasetId === 'data'), 'value')
    expect(references).toContain('First：高级样式表达式')
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'remove', name: 'value', clearReferences: false }))
      .toThrow(/仍被引用/)

    const before = projectSession.getSnapshot()
    projectEdits.execute(command({ type: 'rename', from: 'value', to: 'population' }))
    const renamed = requireMapContent(useProjectStore.getState().project).cartography?.styleLayers.find((layer) => layer.type === 'circle')
    expect(renamed?.type === 'circle' ? renamed.paint?.['circle-color'] : undefined).toEqual([
      'case', ['boolean', ['has', 'population'], false], ['to-string', ['get', 'population']], '#123456'
    ])
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
  })

  it('adds typed defaults to every feature and preserves the string value on undo/redo', () => {
    projectEdits.execute(command({ type: 'add', field: { name: 'externalId', type: 'string', nullable: false }, defaultValue: '0007' }))
    expect(featureData.readSnapshot().data.map((row) => row.properties.externalId)).toEqual(['0007', '0007'])
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.readSnapshot().data).toEqual(rows)
    expect(projectEdits.redo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).datasets[0].fields?.find((field) => field.name === 'externalId')?.nullable).toBe(false)
  })

  it('refuses schema changes through another view when a shared layer inherits a folder lock', () => {
    const project = fixture()
    requireMapContent(project).groups = [{ id: 'locked', name: 'Locked', visible: true, locked: true, layerIds: ['second'] }]
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'rename', from: 'value', to: 'population' })).toThrow(/Second 已锁定/)
    expect(() => prepareFieldSchemaEdit(project, 'data', rows, { type: 'add', field: { name: 'added', type: 'number', nullable: true }, defaultValue: null })).toThrow(/Second 已锁定/)
  })
})
