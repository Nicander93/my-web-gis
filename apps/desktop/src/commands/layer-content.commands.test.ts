import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLayerStyle, createProject, requireMapContent } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { featureData } from '@/project/datasets/feature-data'
import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { layerContentCommands } from './layer-content.commands'

beforeEach(() => {
  const project = createProject('Delete'), content = requireMapContent(project)
  content.datasets = ['shared', 'orphan', 'unrelated'].map(id => ({ id, name: id, kind: 'vector', source: { type: 'memory', label: id } }))
  content.layers = [['first', 'shared'], ['sibling', 'shared'], ['last', 'orphan'], ['other', 'unrelated']].map(([id, datasetId]) => ({
    id, datasetId, name: id, visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point')
  }))
  projectSession.loadSnapshot({ project, featuresByDataset: Object.fromEntries(content.datasets.map(dataset => [dataset.id,
    [{ id: 'row', geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: { owner: dataset.id } }]])) })
})

describe('Application layer content operations', () => {
  it('creates independent local rows with one undo while preserving the previous feature selection', () => {
    const session = useLayerViewStore.getState()
    session.setSelectedLayer('first'); session.setSelectionState({ layerId: 'first', featureIds: ['row'] })
    const before = projectSession.getSnapshot(), unrelated = featureData.readSnapshot().unrelated
    const input = [{ id: 'new-row', geometry: { type: 'Point' as const, coordinates: [1, 2] as [number, number] }, properties: { nested: { value: 1 } } }]
    layerContentCommands.addLayer('new', 'New', input, 'point')
    const layerId = useLayerViewStore.getState().selectedLayerId!
    input[0].properties.nested.value = 9; input[0].geometry.coordinates[0] = 99
    expect(featureData.getById('new', 'new-row')).toMatchObject({ geometry: { coordinates: [1, 2] }, properties: { nested: { value: 1 } } })
    expect(useLayerViewStore.getState().selection).toEqual({ layerId: 'first', featureIds: ['row'] })
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(featureData.readSnapshot().unrelated).toBe(unrelated)
    expect(useLayerViewStore.getState().selectedLayerId).toBe('first')
    expect(projectEdits.canUndo()).toBe(false)
    expect(projectEdits.redo()).toBe(true)
    expect(useLayerViewStore.getState().selectedLayerId).toBe(layerId)
    expect(featureData.getById('new', 'new-row')?.properties.nested).toEqual({ value: 1 })
    expect(useProjectStore.getState()).not.toHaveProperty('addLayer')
    expect(useProjectStore.getState()).not.toHaveProperty('copyFeaturesToLocalLayer')
    expect(useProjectStore.getState()).not.toHaveProperty('addServiceLayer')
  })

  it('preserves redo and all owners when creation fails, and validates before mutating data', () => {
    layerConfigurationCommands.renameLayer('other', 'Changed'); projectEdits.undo()
    const state = useProjectStore.getState(), session = useLayerViewStore.getState(), rows = featureData.readSnapshot(), history = projectEdits.getState()
    expect(() => layerContentCommands.addLayer('shared', 'Duplicate', [], 'point')).toThrow('已存在')
    const setAll = vi.spyOn(featureData, 'setAll').mockImplementation(() => { throw new Error('cannot write rows') })
    try { expect(() => layerContentCommands.addLayer('new', 'New', [], 'point')).toThrow('cannot write rows') }
    finally { setAll.mockRestore() }
    expect(layerContentCommands.copyFeaturesToLocalLayer([], 'Empty', 'point')).toBeNull()
    expect(useProjectStore.getState()).toBe(state); expect(useLayerViewStore.getState()).toBe(session)
    expect(featureData.readSnapshot()).toBe(rows); expect(projectEdits.getState()).toBe(history)
    expect(projectEdits.redo()).toBe(true)
  })

  it('undoes service creation after a bounded load, cancelling the request and removing cached rows', () => {
    const service = layerContentCommands.addServiceLayer({ name: 'Remote', kind: 'wfs', source: { type: 'wfs', url: 'https://example.com/wfs', version: '2.0.0', typeName: 'remote', outputFormat: 'application/json', authMode: 'none' } })!
    featureData.setAll(service.datasetId, [{ id: 'loaded', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }])
    const controller = new AbortController()
    useLayerViewStore.getState().setWfsAbort(service.layerId, controller)
    useLayerViewStore.getState().setLayerLoading(service.layerId, true)
    projectEdits.undo()
    expect(controller.signal.aborted).toBe(true)
    expect(featureData.getDatasetIds()).not.toContain(service.datasetId)
    expect(useLayerViewStore.getState().sessions[service.layerId]).toBeUndefined()
    projectEdits.redo()
    expect(requireMapContent(useProjectStore.getState().project).layers.some(layer => layer.id === service.layerId)).toBe(true)
    expect(featureData.getDatasetIds()).not.toContain(service.datasetId)
  })

  it('retains a shared dataset and its row references through deletion, undo and redo', () => {
    const rows = featureData.readSnapshot(), getAll = vi.spyOn(featureData, 'getAll')
    const content = requireMapContent(useProjectStore.getState().project), sibling = content.layers.find(layer => layer.id === 'sibling')
    const snapshot = vi.spyOn(featureData, 'snapshot').mockImplementation(() => { throw new Error('full data snapshot forbidden') })
    try {
      expect(layerContentCommands.removeLayer('first')).toBe(true)
      expect(requireMapContent(useProjectStore.getState().project).layers.map(layer => layer.id)).toEqual(['sibling', 'last', 'other'])
      expect(featureData.readSnapshot()).toBe(rows)
      expect(requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === 'sibling')).toBe(sibling)
      expect(projectEdits.undo()).toBe(true)
      expect(requireMapContent(useProjectStore.getState().project).layers.map(layer => layer.id)).toEqual(['first', 'sibling', 'last', 'other'])
      expect(projectEdits.redo()).toBe(true)
      expect(featureData.readSnapshot()).toBe(rows)
      expect(requireMapContent(useProjectStore.getState().project).layers.find(layer => layer.id === 'sibling')).toBe(sibling)
      expect(getAll).not.toHaveBeenCalled()
      expect(snapshot).not.toHaveBeenCalled()
    } finally { getAll.mockRestore(); snapshot.mockRestore() }
  })

  it('removes only orphan rows, cancels the removed request and clears its editing sessions before publication', () => {
    const before = projectSession.getSnapshot(), rows = featureData.readSnapshot()
    const removedRequest = new AbortController(), retainedRequest = new AbortController()
    const session = useLayerViewStore.getState()
    session.setWfsAbort('last', removedRequest); session.setWfsAbort('other', retainedRequest)
    session.setSelectedLayer('last'); session.setSelectionState({ layerId: 'last', featureIds: ['row'] })
    session.setAttributeTableState('last', { searchQuery: 'old' })
    session.setAttributeTableState('other', { searchQuery: 'keep' })
    const retainedSession = useLayerViewStore.getState().sessions.other
    useWorkbenchStore.getState().setEditLayer('last'); useWorkbenchStore.getState().setActiveTool('modify')
    const getAll = vi.spyOn(featureData, 'getAll')
    const observed: boolean[] = []
    const unsubscribe = useProjectStore.subscribe(state => {
      if (!requireMapContent(state.project).layers.some(layer => layer.id === 'last')) {
        observed.push(removedRequest.signal.aborted && !useLayerViewStore.getState().sessions.last && useWorkbenchStore.getState().editLayerId === null)
      }
    })
    try {
      expect(layerContentCommands.removeLayer('last')).toBe(true)
      expect(getAll.mock.calls.map(([id]) => id)).toEqual(['orphan'])
      expect(observed).toEqual([true])
      expect(retainedRequest.signal.aborted).toBe(false)
      expect(useLayerViewStore.getState().sessions.other).toBe(retainedSession)
      expect(useLayerViewStore.getState().selection).toEqual({ layerId: null, featureIds: [] })
      expect(useLayerViewStore.getState().selectedLayerId).toBeNull()
      expect(useWorkbenchStore.getState().activeTool).toBe('none')
      expect(featureData.readSnapshot().orphan).toBeUndefined()
      expect(featureData.readSnapshot().unrelated).toBe(rows.unrelated)
      expect(projectEdits.undo()).toBe(true)
      expect(projectSession.getSnapshot()).toEqual(before)
      expect(featureData.readSnapshot().unrelated).toBe(rows.unrelated)
      expect(useLayerViewStore.getState().sessions.last).toBeUndefined()
      expect(projectEdits.redo()).toBe(true)
      expect(featureData.readSnapshot().orphan).toBeUndefined()
    } finally { unsubscribe(); getAll.mockRestore() }
  })

  it('keeps configuration, rows, request, session and redo when data deletion fails', () => {
    layerConfigurationCommands.renameLayer('other', 'Changed'); projectEdits.undo()
    const controller = new AbortController(), session = useLayerViewStore.getState()
    session.setWfsAbort('last', controller); session.setAttributeTableState('last', { searchQuery: 'keep' })
    const state = useProjectStore.getState(), ui = useLayerViewStore.getState(), rows = featureData.readSnapshot(), history = projectEdits.getState()
    const clear = vi.spyOn(featureData, 'clear').mockImplementation(() => { throw new Error('data deletion failed') })
    try { expect(() => layerContentCommands.removeLayer('last')).toThrow('data deletion failed') }
    finally { clear.mockRestore() }
    expect(useProjectStore.getState()).toBe(state)
    expect(useLayerViewStore.getState()).toBe(ui)
    expect(featureData.readSnapshot()).toBe(rows)
    expect(projectEdits.getState()).toBe(history)
    expect(controller.signal.aborted).toBe(false)
    expect(projectEdits.redo()).toBe(true)
  })

  it('rejects a locked descendant without side effects, then deletes a nested group with one undo', () => {
    const outer = layerConfigurationCommands.createGroup('Outer', ['first'])!
    const inner = layerConfigurationCommands.createGroup('Inner', ['last'], outer)!
    layerConfigurationCommands.setGroupLocked(inner, true)
    const state = useProjectStore.getState(), history = projectEdits.getState(), rows = featureData.readSnapshot()
    expect(() => layerContentCommands.removeGroup(outer, true)).toThrow('解锁')
    expect(useProjectStore.getState()).toBe(state); expect(projectEdits.getState()).toBe(history); expect(featureData.readSnapshot()).toBe(rows)
    layerConfigurationCommands.setGroupLocked(inner, false)
    const before = projectSession.getSnapshot()
    layerContentCommands.removeGroup(outer, true)
    expect(requireMapContent(useProjectStore.getState().project).groups).toEqual([])
    expect(requireMapContent(useProjectStore.getState().project).layers.map(layer => layer.id)).toEqual(['sibling', 'other'])
    expect(featureData.readSnapshot().shared).toBe(rows.shared)
    expect(featureData.readSnapshot().orphan).toBeUndefined()
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
  })

  it('does not materialize empty service data on undo or consume redo for missing targets', () => {
    const service = layerContentCommands.addServiceLayer({ name: 'Remote', kind: 'wms', source: { type: 'wms', url: 'https://example.com/wms', version: '1.3.0', layerNames: ['remote'], authMode: 'none' } })!
    expect(featureData.getDatasetIds()).not.toContain(service.datasetId)
    layerContentCommands.removeLayer(service.layerId); projectEdits.undo()
    expect(featureData.getDatasetIds()).not.toContain(service.datasetId)
    const state = useProjectStore.getState(), history = projectEdits.getState()
    expect(layerContentCommands.removeLayer('missing')).toBe(false)
    expect(layerContentCommands.removeGroup('missing', true)).toBe(false)
    expect(useProjectStore.getState()).toBe(state); expect(projectEdits.getState()).toBe(history)
    expect(useProjectStore.getState()).not.toHaveProperty('removeLayer')
    expect(useProjectStore.getState()).not.toHaveProperty('removeGroup')
  })
})
