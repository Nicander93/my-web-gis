import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, createProject, getLayerCartography, MemoryFeatureProvider, ReplaceProjectSnapshotCommand, requireMapContent, SetDatasetContentCommand, type ProjectEditContext } from '@desktop-webgis/project'
import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { featureCommands } from '@/commands/feature.commands'
import { commitLocalImport } from '@/ui/panels/add-data/local-import-command'
import { prepareFieldSchemaEdit, type FieldSchemaEdit } from '@/ui/panels/attribute-table/field-schema-edits'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { featureData } from '@/project/datasets/feature-data'
import { projectEdits } from './project-edits'
import { projectSession } from './project-session'
import { commitDatasetEdits } from './data-save'

let layerId: string
function layer() { return requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === layerId)! }
function schema(edit: FieldSchemaEdit, datasetId = 'data') {
  const result = prepareFieldSchemaEdit(useProjectStore.getState().project, datasetId, featureData.getAll(datasetId), edit)
  projectEdits.execute(new SetDatasetContentCommand(createId('schema'), 'Schema', datasetId, result.before, result.after, result.change))
}
beforeEach(() => {
  projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
  layerContentCommands.addLayer('data', 'Data', [{ id: 'row', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { left: 1, right: 2 } }], 'point')
  layerId = requireMapContent(useProjectStore.getState().project).layers[0].id
  projectEdits.clear()
})

describe('schema commit and configuration history references', () => {
  it('allows pure row commit through resource history when dynamic field names need no remapping', async () => {
    const advanced = structuredClone(getLayerCartography(useProjectStore.getState().project, layerId)!)
    const circle = advanced.styleLayers.find(style => style.type === 'circle')!
    Reflect.set(circle, 'paint', { ...Reflect.get(circle, 'paint'), 'circle-radius': ['get', ['concat', 'le', 'ft']] })
    layerConfigurationCommands.setLayerCartography(layerId, advanced.styleLayers)
    projectEdits.clear()
    const next = projectSession.getSnapshot(); next.project.metadata.id = 'dynamic-b'; next.featuresByDataset.data[0].properties.left = 20
    projectSession.replaceSnapshotAsEdit(next, 'B')
    featureCommands.updateProperties(layerId, 'row', { left: 30, right: 2 })
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true); expect(featureData.getAll('data')[0].properties.left).toBe(1)
    expect(projectEdits.redo()).toBe(true); expect(featureData.getAll('data')[0].properties.left).toBe(30)
    expect(featureData.pendingCount()).toBe(0)
  })

  it('rebases only the matching source side across two projects with the same dataset id', async () => {
    schema({ type: 'rename', from: 'left', to: 'aField' })
    const aNamespace = featureData.getFieldNamespace('data')!
    const next = projectSession.getSnapshot()
    next.project.metadata.id = 'project-b'
    requireMapContent(next.project).datasets[0].fields = [{ name: 'left', type: 'number', nullable: true }, { name: 'right', type: 'number', nullable: true }]
    next.featuresByDataset.data[0].properties = { left: 20, right: 30 }
    projectSession.replaceSnapshotAsEdit(next, 'Project B')
    schema({ type: 'rename', from: 'left', to: 'bField' })
    const bNamespace = featureData.getFieldNamespace('data')!
    expect(bNamespace.identity).not.toBe(aNamespace.identity)
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    const dispose = vi.spyOn(MemoryFeatureProvider.prototype, 'dispose')
    try {
      expect(projectEdits.undo()).toBe(true)
      expect(featureData.getFieldNamespace('data')!.identity).toBe(aNamespace.identity)
      expect(featureData.getAll('data')[0].properties).toEqual({ aField: 1, right: 2 })
      expect((await featureData.readSource('data'))[0].properties).toEqual({ left: 1, right: 2 })
      expect(featureData.pendingCount()).toBeGreaterThan(0)
      expect(await commitDatasetEdits('data', async () => {})).toBe(true)
      expect(projectEdits.canUndo()).toBe(false)
      expect(projectEdits.redo()).toBe(true)
      expect(featureData.getFieldNamespace('data')!.identity).toBe(bNamespace.identity)
      expect(featureData.getAll('data')[0].properties).toEqual({ bField: 20, right: 30 })
      expect(featureData.pendingCount()).toBe(0)
      expect(requireMapContent(useProjectStore.getState().project).datasets[0].fields).toEqual(featureData.getEffectiveFields('data'))
      expect(projectEdits.undo()).toBe(true)
      expect(featureData.getAll('data')[0].properties).toEqual({ aField: 1, right: 2 })
      expect(featureData.pendingCount()).toBe(0)
      expect(dispose).not.toHaveBeenCalled()
      projectEdits.clear()
      expect(dispose).toHaveBeenCalledTimes(1)
      expect((await featureData.readSource('data'))[0].properties).toEqual({ aField: 1, right: 2 })
    } finally { dispose.mockRestore() }
  })

  it('retains replacement resource keys inside a rebased batch and releases retired sources on clear', async () => {
    const a = projectSession.getSnapshot(), b = structuredClone(a), c = structuredClone(a)
    b.project.metadata.id = 'project-b'; b.featuresByDataset.data[0].properties.left = 10
    c.project.metadata.id = 'project-c'; c.featuresByDataset.data[0].properties.left = 20
    projectEdits.executeMany([new ReplaceProjectSnapshotCommand('a-b', 'B', a, b), new ReplaceProjectSnapshotCommand('b-c', 'C', b, c)])
    schema({ type: 'rename', from: 'left', to: 'current' })
    const namespace = featureData.getFieldNamespace('data')!
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    const dispose = vi.spyOn(MemoryFeatureProvider.prototype, 'dispose')
    try {
      expect(projectEdits.undo()).toBe(true)
      expect(featureData.getAll('data')[0].properties).toEqual({ left: 1, right: 2 })
      expect(projectEdits.redo()).toBe(true)
      expect(featureData.getAll('data')[0].properties).toEqual({ current: 20, right: 2 })
      expect(featureData.getFieldNamespace('data')!.identity).toBe(namespace.identity)
      expect(featureData.pendingCount()).toBe(0)
      expect(dispose).not.toHaveBeenCalled()
      expect(projectEdits.undo()).toBe(true)
      projectEdits.clear()
      expect(dispose).toHaveBeenCalledTimes(2)
      expect((await featureData.readSource('data'))[0].properties).toEqual({ left: 1, right: 2 })
    } finally { dispose.mockRestore() }
  })

  it('commits mixed snapshot schema replacement while retaining independent name and label/filter undo', async () => {
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'left', op: 'gt', value: 0 }])
    layerConfigurationCommands.setLayerStyle(layerId, { mode: 'single', symbol: { type: 'circle', radius: 7 }, label: { field: 'left', fontSize: 12 } })
    projectEdits.clear()
    const snapshot = projectSession.getSnapshot(), content = requireMapContent(snapshot.project)
    content.datasets[0].fields = [{ name: 'population', type: 'number', nullable: true }, { name: 'right', type: 'number', nullable: true }]
    content.layers[0].name = 'Mixed'
    content.layers[0].style = { mode: 'single', symbol: { type: 'circle', radius: 7 }, label: { field: 'population', fontSize: 14 } }
    content.layers[0].filter = [{ field: 'population', op: 'gt', value: 0 }]
    snapshot.featuresByDataset.data[0].properties = { population: 1, right: 2 }
    projectSession.applySnapshotAsEdit(snapshot, 'Mixed schema')
    const column = featureData.getFieldNamespace('data')!.fields.get('population')
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true)
    expect(layer().name).toBe('Data'); expect(layer().filter).toEqual([]); expect(layer().style).not.toHaveProperty('label')
    expect(featureData.getAll('data')[0].properties).toEqual({ population: 1, right: 2 })
    expect(featureData.getFieldNamespace('data')!.fields.get('population')).toBe(column)
    expect(featureData.getEffectiveFields('data')).toEqual(content.datasets[0].fields)
    expect(projectEdits.redo()).toBe(true)
    expect(layer().name).toBe('Mixed'); expect(layer().filter).toEqual([{ field: 'population', op: 'gt', value: 0 }])
    expect(layer().style).toMatchObject({ label: { field: 'population', fontSize: 14 } })
    expect(featureData.pendingCount()).toBe(0)
  })

  it('ends a pure schema-removal snapshot without leaving stale field undo', async () => {
    const snapshot = projectSession.getSnapshot()
    requireMapContent(snapshot.project).datasets[0].fields = [{ name: 'right', type: 'number', nullable: true }]
    delete snapshot.featuresByDataset.data[0].properties.left
    projectSession.applySnapshotAsEdit(snapshot, 'Remove left')
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.canUndo()).toBe(false)
    expect(featureData.pendingCount()).toBe(0)
    expect((await featureData.readSource('data'))[0].properties).toEqual({ right: 2 })
  })

  it('rebases two sources with schema changes and preserves the unsaved source frame until its own commit', async () => {
    layerContentCommands.addLayer('other', 'Other', [{ id: 'other', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { old: 2 } }], 'point')
    projectEdits.clear()
    const snapshot = projectSession.getSnapshot(), content = requireMapContent(snapshot.project)
    content.layers[0].name = 'Mixed'
    content.datasets.find(dataset => dataset.id === 'data')!.fields = [{ name: 'right', type: 'number', nullable: true }]
    delete snapshot.featuresByDataset.data[0].properties.left
    content.datasets.find(dataset => dataset.id === 'other')!.fields = [{ name: 'score', type: 'number', nullable: true }]
    snapshot.featuresByDataset.other[0].properties = { score: 8 }
    projectSession.applySnapshotAsEdit(snapshot, 'Mixed schemas')
    const score = featureData.getFieldNamespace('other')!.fields.get('score')
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.getAll('data')[0].properties).toEqual({ right: 2 })
    expect(featureData.getAll('other')[0].properties).toEqual({ old: 2 })
    expect(featureData.pendingCount()).toBe(0)
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.getFieldNamespace('other')!.fields.get('score')).toBe(score)
    expect(await commitDatasetEdits('other', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true); expect(layer().name).toBe('Data')
    expect(featureData.getAll('data')[0].properties).toEqual({ right: 2 })
    expect(featureData.getAll('other')[0].properties).toEqual({ score: 8 })
    expect(featureData.pendingCount()).toBe(0)
  })

  it('retires an old advanced paint operand in a committed mixed schema snapshot', async () => {
    const fragment = structuredClone(getLayerCartography(useProjectStore.getState().project, layerId)!)
    const circle = fragment.styleLayers.find(style => style.type === 'circle')!
    Reflect.set(circle, 'paint', { ...Reflect.get(circle, 'paint'), 'circle-radius': ['get', 'left'] })
    layerConfigurationCommands.setLayerCartography(layerId, fragment.styleLayers)
    projectEdits.clear()
    const snapshot = projectSession.getSnapshot(), content = requireMapContent(snapshot.project)
    content.datasets[0].fields = [{ name: 'right', type: 'number', nullable: true }]
    delete snapshot.featuresByDataset.data[0].properties.left
    const advanced = content.cartography!.styleLayers.find(style => style.type === 'circle')!
    Reflect.set(advanced, 'paint', { ...Reflect.get(advanced, 'paint'), 'circle-radius': 4 })
    projectSession.applySnapshotAsEdit(snapshot, 'Remove referenced left')
    const write = vi.fn()
    expect(await commitDatasetEdits('data', write)).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    expect(projectEdits.undo()).toBe(true)
    expect(Reflect.get(getLayerCartography(useProjectStore.getState().project, layerId)!.styleLayers.find(style => style.type === 'circle')!, 'paint')).not.toHaveProperty('circle-radius')
    expect(featureData.getAll('data')[0].properties).toEqual({ right: 2 })
    expect(projectEdits.redo()).toBe(true)
    expect(Reflect.get(getLayerCartography(useProjectStore.getState().project, layerId)!.styleLayers.find(style => style.type === 'circle')!, 'paint')).toHaveProperty('circle-radius', 4)
    expect(featureData.pendingCount()).toBe(0)
  })

  it('commits deletion after the user removes the current advanced dependency and keeps independent style history', async () => {
    const advanced = structuredClone(getLayerCartography(useProjectStore.getState().project, layerId)!)
    const circle = advanced.styleLayers.find(style => style.type === 'circle')!
    Reflect.set(circle, 'paint', { ...Reflect.get(circle, 'paint'), 'circle-radius': ['get', 'left'], 'circle-opacity': 0.4 })
    layerConfigurationCommands.setLayerCartography(layerId, advanced.styleLayers)
    // 当前生效的样式仍然使用严格的 schema 守卫。
    expect(() => schema({ type: 'remove', name: 'left', clearReferences: true })).toThrow('仍引用字段 left')
    const adjusted = structuredClone(advanced)
    Reflect.set(adjusted.styleLayers.find(style => style.type === 'circle')!, 'paint', { ...Reflect.get(circle, 'paint'), 'circle-radius': 4 })
    layerConfigurationCommands.setLayerCartography(layerId, adjusted.styleLayers)
    schema({ type: 'remove', name: 'left', clearReferences: true })
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true)
    const paint = Reflect.get(getLayerCartography(useProjectStore.getState().project, layerId)!.styleLayers.find(style => style.type === 'circle')!, 'paint')
    expect(paint).not.toHaveProperty('circle-radius'); expect(paint).toHaveProperty('circle-opacity', 0.4)
    expect(featureData.getAll('data')[0].properties).toEqual({ right: 2 })
    expect(projectEdits.redo()).toBe(true)
    expect(Reflect.get(getLayerCartography(useProjectStore.getState().project, layerId)!.styleLayers.find(style => style.type === 'circle')!, 'paint')).toHaveProperty('circle-radius', 4)
    expect(featureData.pendingCount()).toBe(0)
  })

  it('restores only the historical advanced classification fallback after its column is committed as deleted', async () => {
    layerConfigurationCommands.setLayerStyle(layerId, { mode: 'categorized', field: 'left', categories: [{ value: 1, symbol: { type: 'circle', radius: 9 } }], fallback: { type: 'circle', radius: 3 } })
    const advanced = structuredClone(getLayerCartography(useProjectStore.getState().project, layerId)!)
    const fallback = advanced.styleLayers.find(style => Reflect.get(Reflect.get(style.metadata!, 'my-web-gis:cartography'), 'classification')?.fallback)!
    Reflect.set(fallback, 'paint', { ...Reflect.get(fallback, 'paint'), 'circle-stroke-width': 2 })
    layerConfigurationCommands.setLayerCartography(layerId, advanced.styleLayers)
    layerConfigurationCommands.setLayerStyle(layerId, { mode: 'single', symbol: { type: 'circle', radius: 6 } })
    schema({ type: 'remove', name: 'left', clearReferences: true })
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true)
    const restored = getLayerCartography(useProjectStore.getState().project, layerId)!
    expect(restored.styleLayers.map(style => style.id)).toEqual([fallback.id])
    expect(restored.binding.styleLayerIds).toEqual([fallback.id])
    expect(Reflect.get(restored.styleLayers[0], 'paint')).toHaveProperty('circle-stroke-width', 2)
    expect(Reflect.get(restored.styleLayers[0], 'filter')).toEqual(['all', ['==', ['geometry-type'], 'Point']])
    expect(featureData.getAll('data')[0].properties).toEqual({ right: 2 })
    expect(featureData.pendingCount()).toBe(0)
  })

  it('rebases generated classification and label fragments through deletion and name reuse', async () => {
    layerConfigurationCommands.setLayerStyle(layerId, { mode: 'categorized', field: 'left',
      categories: [{ value: 1, label: 'left', symbol: { type: 'circle', radius: 8 } }],
      fallback: { type: 'circle', radius: 3 }, label: { field: 'right', fontSize: 12 } })
    schema({ type: 'remove', name: 'right', clearReferences: true })
    schema({ type: 'rename', from: 'left', to: 'right' })
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true); expect(layer().style).not.toHaveProperty('field')
    expect(projectEdits.redo()).toBe(true)
    expect(layer().style).toMatchObject({ mode: 'categorized', field: 'right', categories: [{ value: 1, label: 'left' }] })
    expect(layer().style).not.toHaveProperty('label')
    expect(featureData.pendingCount()).toBe(0)
  })

  it('restores acknowledged rows and schema when a newly created source is undone and redone', async () => {
    layerContentCommands.addLayer('created', 'Created', [{ id: 'new', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { old: 1 } }], 'point')
    const prepared = prepareFieldSchemaEdit(useProjectStore.getState().project, 'created', featureData.getAll('created'), { type: 'rename', from: 'old', to: 'new' })
    projectEdits.execute(new SetDatasetContentCommand('rename-created', 'Rename', 'created', prepared.before, prepared.after, prepared.change))
    const write = vi.fn()
    expect(await commitDatasetEdits('created', write)).toBe(true)
    const namespace = featureData.getFieldNamespace('created')!
    expect(write).toHaveBeenCalledTimes(1)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).datasets.some(dataset => dataset.id === 'created')).toBe(false)
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.getAll('created')[0].properties).toEqual({ new: 1 })
    expect(requireMapContent(useProjectStore.getState().project).datasets.find(dataset => dataset.id === 'created')!.fields).toEqual([{ name: 'new', type: 'number', nullable: true }])
    expect(featureData.getFieldNamespace('created')!.identity).toBe(namespace.identity)
    expect(featureData.pendingCount()).toBe(0)
  })

  it('preserves multi-layer import selection callbacks and the other source pending edits', async () => {
    useLayerViewStore.getState().setSelectedLayer(layerId)
    commitLocalImport({ errors: [], layers: ['First', 'Second'].map((name, index) => ({ name, styleKind: 'point', warnings: [],
      fields: [{ name: 'left', type: 'number', nullable: true }], features: [{ id: name, geometry: { type: 'Point', coordinates: [116, 39] }, properties: { left: index + 1 } }] })) })
    const content = requireMapContent(useProjectStore.getState().project)
    const first = content.layers.find(layer => layer.name === 'First')!, second = content.layers.find(layer => layer.name === 'Second')!
    const namespace = featureData.getFieldNamespace(first.datasetId)!
    schema({ type: 'rename', from: 'left', to: 'population' }, first.datasetId)
    featureCommands.updateProperties(second.id, 'Second', { left: 9 })
    expect(await commitDatasetEdits(first.datasetId, async () => {})).toBe(true)
    expect(featureData.pendingCount(second.datasetId)).toBe(1)
    expect((await featureData.readSource(second.datasetId))[0].properties).toEqual({ left: 2 })
    expect(projectEdits.undo()).toBe(true)
    expect(projectEdits.undo()).toBe(true)
    expect(useLayerViewStore.getState().selectedLayerId).toBe(layerId)
    expect(requireMapContent(useProjectStore.getState().project).layers).toHaveLength(1)
    expect(projectEdits.redo()).toBe(true)
    expect(useLayerViewStore.getState().selectedLayerId).toBe(second.id)
    expect(featureData.getAll(first.datasetId)[0].properties).toEqual({ population: 1 })
    expect(featureData.getEffectiveFields(first.datasetId)).toEqual([{ name: 'population', type: 'number', nullable: true }])
    expect(featureData.getFieldNamespace(first.datasetId)!.identity).toBe(namespace.identity)
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.getAll(second.datasetId)[0].properties).toEqual({ left: 9 })
    expect(featureData.pendingCount(first.datasetId)).toBe(0)
    expect(featureData.pendingCount(second.datasetId)).toBe(1)
  })

  it('preserves both acknowledged schemas across two commits and import undo/redo', async () => {
    commitLocalImport({ errors: [], layers: ['First', 'Second'].map(name => ({ name, styleKind: 'point', warnings: [],
      features: [{ id: name, geometry: { type: 'Point', coordinates: [0, 0] }, properties: { old: name } }] })) })
    const imported = requireMapContent(useProjectStore.getState().project).layers.filter(item => item.id !== layerId)
    for (const item of imported) schema({ type: 'rename', from: 'old', to: 'current' }, item.datasetId)
    for (const item of imported) expect(await commitDatasetEdits(item.datasetId, async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers).toHaveLength(1)
    expect(projectEdits.redo()).toBe(true)
    for (const item of imported) {
      expect(featureData.getAll(item.datasetId)[0].properties).toEqual({ current: item.name })
      expect(featureData.getEffectiveFields(item.datasetId)).toEqual([{ name: 'current', type: 'string', nullable: true }])
      expect(requireMapContent(useProjectStore.getState().project).datasets.find(dataset => dataset.id === item.datasetId)!.fields).toEqual(featureData.getEffectiveFields(item.datasetId))
    }
    expect(featureData.pendingCount()).toBe(0)
  })

  it('rebases an undone removal before redo and restores the same committed source on undo', async () => {
    schema({ type: 'rename', from: 'left', to: 'current' })
    layerContentCommands.removeLayer(layerId)
    expect(projectEdits.undo()).toBe(true)
    const namespace = featureData.getFieldNamespace('data')!
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.redo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers).toHaveLength(0)
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.getAll('data')[0].properties).toEqual({ current: 1, right: 2 })
    expect(featureData.getFieldNamespace('data')!.identity).toBe(namespace.identity)
    expect(requireMapContent(useProjectStore.getState().project).datasets[0].fields).toEqual(featureData.getEffectiveFields('data'))
    expect(featureData.pendingCount()).toBe(0)
  })

  it('reuses the original schema frame when one source in a mixed snapshot is committed', async () => {
    layerContentCommands.addLayer('other', 'Other', [{ id: 'other', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 2 } }], 'point')
    projectEdits.clear()
    const original = featureData.getFieldNamespace('other')!
    const snapshot = projectSession.getSnapshot()
    snapshot.featuresByDataset.data[0].properties.left = 9
    snapshot.featuresByDataset.other[0].properties.extra = 3
    projectSession.applySnapshotAsEdit(snapshot, 'Mixed')
    const extra = featureData.getFieldNamespace('other')!.fields.get('extra')
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true)
    expect([...featureData.getFieldNamespace('other')!.fields]).toEqual([...original.fields])
    expect(featureData.pendingCount()).toBe(0)
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.getFieldNamespace('other')!.fields.get('extra')).toBe(extra)
    expect(featureData.getAll('data')[0].properties.left).toBe(9)
    expect(featureData.pendingCount('data')).toBe(0)
    expect(featureData.pendingCount('other')).toBe(1)
  })

  it('rebases merged legacy style history and a standard expression without rewriting literal text', async () => {
    layerConfigurationCommands.setLayerStyle(layerId, { mode: 'single', symbol: { type: 'circle', radius: 7 }, label: { field: 'left', fontSize: 12 } }, 'gesture')
    layerConfigurationCommands.setLayerStyle(layerId, { mode: 'single', symbol: { type: 'circle', radius: 8 }, label: { field: 'left', fontSize: 14 } }, 'gesture')
    const fragment = structuredClone(getLayerCartography(useProjectStore.getState().project, layerId)!)
    const circle = fragment.styleLayers.find(style => style.type === 'circle')!
    Reflect.set(circle, 'paint', { ...Reflect.get(circle, 'paint'), 'circle-radius': ['case', ['==', ['get', 'left'], 1], 9, 3] })
    const text = fragment.styleLayers.find(style => style.type === 'symbol')!
    Reflect.set(text, 'layout', { ...Reflect.get(text, 'layout'), 'text-field': ['concat', 'left:', ['get', 'left']] })
    layerConfigurationCommands.setLayerCartography(layerId, fragment.styleLayers)
    schema({ type: 'rename', from: 'left', to: 'population' })
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true)
    expect(layer().style).toMatchObject({ label: { field: 'population', fontSize: 14 } })
    expect(projectEdits.undo()).toBe(true); expect(layer().style).not.toHaveProperty('label')
    expect(projectEdits.redo()).toBe(true); expect(layer().style).toMatchObject({ label: { field: 'population', fontSize: 14 } })
    expect(projectEdits.redo()).toBe(true)
    const saved = getLayerCartography(useProjectStore.getState().project, layerId)!
    expect(Reflect.get(saved.styleLayers.find(style => style.type === 'symbol')!, 'layout')).toMatchObject({ 'text-field': ['concat', 'left:', ['get', 'population']] })
    expect(featureData.pendingCount()).toBe(0)
  })

  it('commits a rename and rebases older tree and filter mementos without reverting committed rows', async () => {
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'left', op: 'gt', value: 0 }])
    layerConfigurationCommands.renameLayer(layerId, 'Configured')
    schema({ type: 'rename', from: 'left', to: 'population' })
    const write = vi.fn()
    expect(await commitDatasetEdits('data', write)).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    expect((await featureData.readSource('data'))[0].properties).toEqual({ population: 1, right: 2 })
    expect(projectEdits.undo()).toBe(true)
    expect(layer().name).toBe('Data'); expect(layer().filter).toEqual([{ field: 'population', op: 'gt', value: 0 }])
    expect(projectEdits.undo()).toBe(true); expect(layer().filter).toEqual([])
    expect(projectEdits.canUndo()).toBe(false)
    expect(projectEdits.redo()).toBe(true); expect(layer().filter).toEqual([{ field: 'population', op: 'gt', value: 0 }])
    expect(projectEdits.redo()).toBe(true); expect(layer().name).toBe('Configured')
    expect(featureData.pendingCount()).toBe(0)
    expect(featureData.getAll('data')[0].properties).toEqual({ population: 1, right: 2 })
  })

  it('distinguishes delete/right from left renamed to right when older filters are replayed', async () => {
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'left', op: 'eq', value: 1 }, { field: 'right', op: 'eq', value: 2 }])
    schema({ type: 'remove', name: 'right', clearReferences: true })
    schema({ type: 'rename', from: 'left', to: 'right' })
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(layer().filter).toEqual([{ field: 'right', op: 'eq', value: 1 }])
    expect(projectEdits.undo()).toBe(true); expect(layer().filter).toEqual([])
    expect(projectEdits.redo()).toBe(true); expect(layer().filter).toEqual([{ field: 'right', op: 'eq', value: 1 }])
    expect(featureData.getAll('data')[0].properties).toEqual({ right: 1 })
    expect(featureData.pendingCount()).toBe(0)
  })

  it('retains the redo branch and rebases the same configuration again on a later commit', async () => {
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'left', op: 'gt', value: 0 }])
    schema({ type: 'rename', from: 'left', to: 'population' })
    layerConfigurationCommands.renameLayer(layerId, 'Redo name')
    expect(projectEdits.undo()).toBe(true)
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.redo()).toBe(true); expect(layer().name).toBe('Redo name')
    schema({ type: 'rename', from: 'population', to: 'count' })
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(projectEdits.undo()).toBe(true); expect(layer().name).toBe('Data')
    expect(projectEdits.undo()).toBe(true); expect(layer().filter).toEqual([])
    expect(projectEdits.redo()).toBe(true); expect(layer().filter).toEqual([{ field: 'count', op: 'gt', value: 0 }])
    expect(featureData.pendingCount()).toBe(0)
  })

  it('keeps original history after failure and freezes history until schema acknowledgement ends', async () => {
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'left', op: 'gt', value: 0 }])
    schema({ type: 'rename', from: 'left', to: 'population' })
    let fail!: (error: Error) => void
    const pending = commitDatasetEdits('data', () => new Promise((_resolve, reject) => { fail = reject }))
    expect(projectEdits.undo()).toBe(false)
    expect(projectEdits.getBlockReason('undo')).toContain('字段提交进行中')
    expect(() => layerConfigurationCommands.renameLayer(layerId, 'During save')).toThrow('字段提交进行中')
    fail(new Error('disk failure'))
    await expect(pending).rejects.toThrow('disk failure')
    expect(projectEdits.getBlockReason('undo')).toBeNull()
    expect(projectEdits.undo()).toBe(true)
    expect(layer().filter).toEqual([{ field: 'left', op: 'gt', value: 0 }])
    expect(featureData.getAll('data')[0].properties).toEqual({ left: 1, right: 2 })
    expect(featureData.pendingCount()).toBe(0)
  })

  it('rejects opaque configuration history before writing and preserves it for undo', async () => {
    const before = layer().name
    projectEdits.execute({ id: 'opaque', label: 'Opaque', scope: 'configuration', execute(context: ProjectEditContext) {
      const project = structuredClone(context.getProject()); requireMapContent(project).layers[0].name = 'Opaque'; context.replaceProject(project)
    }, undo(context: ProjectEditContext) {
      const project = structuredClone(context.getProject()); requireMapContent(project).layers[0].name = before; context.replaceProject(project)
    } })
    schema({ type: 'rename', from: 'left', to: 'population' })
    const write = vi.fn()
    await expect(commitDatasetEdits('data', write)).rejects.toThrow('schema-aware reference rebase')
    expect(write).not.toHaveBeenCalled()
    expect(projectEdits.undo()).toBe(true); expect(projectEdits.undo()).toBe(true); expect(layer().name).toBe('Data')
  })
})
