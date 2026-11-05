import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerConfigurationQueries } from '@/project/layer-configuration-query'
import { projectSession } from '@/project/project-session'
import { featureCommands } from '@/commands/feature.commands'
import { projectEdits } from '@/project/project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { selectionCommands } from '@/commands/selection.commands'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLayerStyle, createProject, MemoryFeatureStore, requireMapContent, UpdateGeometryCommand, type GisFeature, type ProjectEditContext } from '@desktop-webgis/project'
import { useProjectStore } from './project.store'

beforeEach(() => {
  const project = createProject('Configuration')
  const map = requireMapContent(project)
  map.datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  map.layers = [{ id: 'layer', datasetId: 'data', name: 'Layer', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
  projectSession.loadSnapshot({ project, featuresByDataset: { data: [
    { id: 'low', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } },
    { id: 'high', geometry: { type: 'Point', coordinates: [1, 0] }, properties: { value: 9 } }
  ] } })
})
afterEach(() => vi.restoreAllMocks())

describe('configuration transaction boundary', () => {
  it('edits the sole data owner without copying unrelated rows into ProjectStore', () => {
    const state = useProjectStore.getState(), before = featureData.readSnapshot(), configRevision = state.configRevision
    const datasetRead = vi.spyOn(featureData, 'getAll'), snapshot = vi.spyOn(featureData, 'snapshot'), replace = vi.spyOn(featureData, 'setAll')
    const listener = vi.fn(), unsubscribe = featureData.subscribe(listener)
    try {
      expect(state).not.toHaveProperty('featuresByDataset')
      projectEdits.execute(new UpdateGeometryCommand('one-row', 'data', 'low', before.data[0].geometry, { type: 'Point', coordinates: [2, 3] }))
      const after = featureData.readSnapshot()
      expect(after.data[0].geometry).toEqual({ type: 'Point', coordinates: [2, 3] })
      expect(after.data[1]).toBe(before.data[1])
      expect(datasetRead).not.toHaveBeenCalled()
      expect(snapshot).not.toHaveBeenCalled()
      expect(replace).not.toHaveBeenCalled()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(useProjectStore.getState().configRevision).toBe(configRevision)
      expect(projectEdits.undo()).toBe(true)
      expect(featureData.readSnapshot().data[0].geometry).toEqual(before.data[0].geometry)
    } finally { unsubscribe() }
  })

  it('rolls back a failed row command without publishing data or adding history', () => {
    const state = useProjectStore.getState(), before = featureData.readSnapshot(), revision = featureData.revision
    const listener = vi.fn(), unsubscribe = featureData.subscribe(listener)
    try {
      expect(() => projectEdits.execute({ id: 'failed-data', label: 'Failed data', execute(context) {
        context.featureStore.update('data', { ...before.data[0], properties: { value: 99 } })
        throw new Error('Rejected')
      }, undo() {} })).toThrow('Rejected')
      expect(featureData.readSnapshot()).toBe(before)
      expect(featureData.revision).toBe(revision)
      expect(useProjectStore.getState().dirty).toBe(false)
      expect(projectEdits.canUndo()).toBe(false)
      expect(listener).not.toHaveBeenCalled()
    } finally { unsubscribe() }
  })

  it('keeps browsing and feature selection only in the session without publishing project content', () => {
    const state = useProjectStore.getState(), project = state.project
    const changed = vi.fn(), unsubscribe = useProjectStore.subscribe(changed)
    try {
      useLayerViewStore.getState().setSelectedLayer('layer')
      selectionCommands.setSelection({ layerId: 'layer', featureIds: ['high', 'missing'] })
      expect(useLayerViewStore.getState().selection).toEqual({ layerId: 'layer', featureIds: ['high'] })
      selectionCommands.toggleFeatureSelection('layer', 'low')
      expect(useLayerViewStore.getState().selection.featureIds).toEqual(['high', 'low'])
      expect(useLayerViewStore.getState().selectedLayerId).toBe('layer')
      expect(useProjectStore.getState()).not.toHaveProperty('selection')
      expect(useProjectStore.getState()).not.toHaveProperty('selectedLayerId')
      expect(useProjectStore.getState().project).toBe(project)
      expect(useProjectStore.getState().dirty).toBe(false)
      expect(useProjectStore.getState().configRevision).toBe(0)
      expect(changed).not.toHaveBeenCalled()
      projectSession.loadSnapshot({ project: createProject('Scene', 'scene3d'), featuresByDataset: {} })
      expect(useLayerViewStore.getState().selection).toEqual({ layerId: null, featureIds: [] })
      expect(useLayerViewStore.getState().selectedLayerId).toBeNull()
      expect(useLayerViewStore.getState().lastSelectionCountAfterFilter).toBeNull()
      expect(featureData.getDatasetIds()).toEqual([])
    } finally { unsubscribe() }
  })

  it('changes style, visibility, opacity and tree history without reading a 10,000-feature dataset', () => {
    const features: GisFeature[] = Array.from({ length: 10_000 }, (_, index) => ({ id: `f-${index}`,
      geometry: { type: 'Point', coordinates: [index / 10_000, 0] }, properties: { value: index } }))
    let reads = 0
    const guarded = new Proxy(features, { get(target, key, receiver) {
      if (key === Symbol.iterator || typeof key === 'string' && /^\d+$/.test(key)) reads++
      return Reflect.get(target, key, receiver)
    } })
    featureData.replaceAll({ data: guarded }); useLayerViewStore.setState({ selection: { layerId: 'layer', featureIds: ['f-1'] } })
    const beforeFeatures = featureData.readSnapshot()
    reads = 0
    const readView = vi.spyOn(featureData, 'readSnapshot')
    const setAll = vi.spyOn(MemoryFeatureStore.prototype, 'setAll')
    const snapshot = vi.spyOn(MemoryFeatureStore.prototype, 'snapshot')
    const getAll = vi.spyOn(MemoryFeatureStore.prototype, 'getAll')
    const state = useProjectStore.getState()
    layerConfigurationCommands.setLayerStyle('layer', { mode: 'single', symbol: { type: 'circle', radius: 9 } })
    expect(projectEdits.undo()).toBe(true)
    expect(projectEdits.redo()).toBe(true)
    layerConfigurationCommands.setLayerVisible('layer', false)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers[0].visible).toBe(true)
    expect(projectEdits.redo()).toBe(true)
    layerConfigurationCommands.setLayerOpacity('layer', 0.4)
    layerConfigurationCommands.renameLayer('layer', 'Renamed')
    expect(projectEdits.undo()).toBe(true)
    expect(projectEdits.redo()).toBe(true)
    expect(reads).toBe(0)
    expect(setAll).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(getAll).not.toHaveBeenCalled()
    expect(readView).not.toHaveBeenCalled()
    expect(featureData.readSnapshot()).toBe(beforeFeatures)
    expect(useLayerViewStore.getState().selection).toEqual({ layerId: 'layer', featureIds: ['f-1'] })
  })

  it('does not publish or add history for unchanged visibility', () => {
    const listener = vi.fn(), unsubscribe = useProjectStore.subscribe(listener)
    try {
      const before = useProjectStore.getState().project
      layerConfigurationCommands.setLayerVisible('layer', true)
      expect(useProjectStore.getState().project).toBe(before)
      expect(projectEdits.canUndo()).toBe(false)
      expect(listener).not.toHaveBeenCalled()
    } finally { unsubscribe() }
  })

  it('tracks configuration separately from feature, session and save acknowledgements', () => {
    const state = useProjectStore.getState(), epoch = state.projectEpoch
    expect(state.configRevision).toBe(0)
    useLayerViewStore.getState().setSelectedLayer('layer')
    selectionCommands.setSelection({ layerId: 'layer', featureIds: ['low'] })
    state.setDirty(false)
    expect(useProjectStore.getState().configRevision).toBe(0)
    featureCommands.updateProperties('layer', 'low', { value: 2 })
    expect(useProjectStore.getState().configRevision).toBe(0)
    layerConfigurationCommands.setLayerVisible('layer', false)
    expect(useProjectStore.getState().configRevision).toBe(1)
    projectEdits.undo()
    expect(useProjectStore.getState().configRevision).toBe(2)
    projectEdits.redo()
    expect(useProjectStore.getState().configRevision).toBe(3)
    layerConfigurationCommands.setLayerVisible('layer', false)
    expect(useProjectStore.getState().configRevision).toBe(3)
    projectSession.loadSnapshot(projectSession.getSnapshot())
    expect(useProjectStore.getState().projectEpoch).toBe(epoch + 1)
    expect(useProjectStore.getState().configRevision).toBe(0)
  })

  it('rejects data access after staging configuration without publishing partial state or history', () => {
    const before = useProjectStore.getState(), beforeFeatureData = featureData.readSnapshot(), listener = vi.fn(), unsubscribe = useProjectStore.subscribe(listener)
    try {
      expect(() => projectEdits.execute({ id: 'invalid-scope', label: 'Invalid config', scope: 'configuration',
        execute(context) {
          const projectContext = context as ProjectEditContext, project = projectContext.getProject()
          projectContext.replaceProject({ ...project, metadata: { ...project.metadata, name: 'Must not publish' } })
          context.featureStore.clear('data')
        }, undo() {}
      })).toThrow('不能访问要素数据')
      expect(useProjectStore.getState().project).toBe(before.project)
      expect(featureData.readSnapshot()).toBe(beforeFeatureData)
      expect(useProjectStore.getState().dirty).toBe(false)
      expect(projectEdits.canUndo()).toBe(false)
      expect(listener).not.toHaveBeenCalled()
    } finally { unsubscribe() }
  })

  it('retains the previous gesture undo/redo when a later style update fails validation', () => {
    const state = useProjectStore.getState(), original = layerConfigurationQueries.getNormalizedLayerStyle('layer')
    const valid = { mode: 'single' as const, symbol: { type: 'circle' as const, radius: 9 } }
    layerConfigurationCommands.setLayerStyle('layer', valid, 'gesture')
    const before = useProjectStore.getState().project
    expect(() => layerConfigurationCommands.setLayerStyle('layer', { ...valid, symbol: { ...valid.symbol, radius: NaN } }, 'gesture')).toThrow()
    expect(useProjectStore.getState().project).toBe(before)
    expect(projectEdits.undo()).toBe(true)
    expect(layerConfigurationQueries.getNormalizedLayerStyle('layer')).toEqual(original)
    expect(projectEdits.redo()).toBe(true)
    expect(layerConfigurationQueries.getNormalizedLayerStyle('layer')).toEqual(valid)
  })

  it('converges selection for a real filter change without replacing the data collection', () => {
    const state = useProjectStore.getState()
    selectionCommands.setSelection({ layerId: 'layer', featureIds: ['low', 'high'] })
    const features = featureData.readSnapshot()
    const publishedSelections: string[][] = []
    const unsubscribe = useProjectStore.subscribe(current => publishedSelections.push(useLayerViewStore.getState().selection.featureIds))
    layerConfigurationCommands.setLayerFilter('layer', [{ field: 'value', op: 'gt', value: 5 }])
    unsubscribe()
    expect(publishedSelections).toEqual([['high']])
    expect(useLayerViewStore.getState().selection.featureIds).toEqual(['high'])
    expect(featureData.readSnapshot()).toBe(features)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers[0].filter).toEqual([])
    expect(featureData.readSnapshot()).toBe(features)
  })
})
