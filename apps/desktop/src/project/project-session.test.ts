import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultLayerStyle, createProject, requireMapContent, type GisFeature } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { featureCommands } from '@/commands/feature.commands'
import { featureData } from '@/project/datasets/feature-data'
import { projectEdits } from './project-edits'
import { projectSession } from './project-session'

function snapshot(datasetId = 'old') {
  const project = createProject('Lifecycle'), content = requireMapContent(project)
  content.datasets = [{ id: datasetId, name: datasetId, kind: 'vector', source: { type: 'memory', label: datasetId } }]
  content.layers = [{ id: 'layer', datasetId, name: 'Layer', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
  const features: GisFeature[] = [{ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }]
  return { project, featuresByDataset: { [datasetId]: features } }
}

beforeEach(() => projectSession.loadSnapshot(snapshot()))

describe('Application project lifecycle', () => {
  it('opens the file style definition without interpreting a different legacy cache as an edit of the previous project', () => {
    const incoming = projectSession.getSnapshot(), content = requireMapContent(incoming.project)
    const standardDrawing = structuredClone(content.cartography)
    content.layers[0].style = { mode: 'single', symbol: { type: 'circle', radius: 23 } }
    projectSession.loadSnapshot(incoming)
    const loaded = requireMapContent(useProjectStore.getState().project)
    expect(loaded.layers[0].style).toEqual(content.layers[0].style)
    expect(loaded.cartography).toEqual(standardDrawing)
  })

  it('replaces data, aborts old work and resets history/session under a new epoch even for the same project ID', () => {
    featureCommands.updateProperties('layer', 'row', { value: 2 })
    const controller = new AbortController(), before = useProjectStore.getState()
    const generation = useLayerViewStore.getState().wfsLoadGeneration
    useLayerViewStore.getState().setWfsAbort('layer', controller)
    useLayerViewStore.getState().setSelectedLayer('layer')
    useLayerViewStore.getState().setAttributeTableState('layer', { searchQuery: 'old rows' })
    useWorkbenchStore.getState().setEditLayer('layer')
    const next = snapshot('next')
    next.project.metadata.id = before.project.metadata.id
    projectSession.loadSnapshot(next)
    expect(controller.signal.aborted).toBe(true)
    expect(useLayerViewStore.getState().wfsLoadGeneration).toBe(generation + 1)
    expect(useLayerViewStore.getState().wfsAbortByLayer).toEqual({})
    expect(useLayerViewStore.getState().sessions).toEqual({})
    expect(useLayerViewStore.getState().selectedLayerId).toBeNull()
    expect(useWorkbenchStore.getState().editLayerId).toBeNull()
    expect(projectEdits.canUndo()).toBe(false)
    expect(projectEdits.canRedo()).toBe(false)
    expect(useProjectStore.getState()).toMatchObject({ projectEpoch: before.projectEpoch + 1, configRevision: 0, dirty: false })
    expect(featureData.getDatasetIds()).toEqual(['next'])
    next.featuresByDataset.next[0].properties.value = 99
    expect(featureData.getById('next', 'row')?.properties.value).toBe(1)
    const exported = projectSession.getSnapshot()
    exported.featuresByDataset.next[0].properties.value = 88
    expect(featureData.getById('next', 'row')?.properties.value).toBe(1)
    expect(useProjectStore.getState()).not.toHaveProperty('loadSnapshot')
    expect(useProjectStore.getState()).not.toHaveProperty('getSnapshot')
  })

  it('rejects mixed workspace replacement before cancelling work or clearing data, UI or history', () => {
    featureCommands.updateProperties('layer', 'row', { value: 3 })
    const controller = new AbortController()
    useLayerViewStore.getState().setWfsAbort('layer', controller)
    const state = useProjectStore.getState(), session = useLayerViewStore.getState(), rows = featureData.readSnapshot(), history = projectEdits.getState()
    expect(() => projectSession.loadSnapshot({ project: createProject('Scene', 'scene3d'), featuresByDataset: { old: rows.old } })).toThrow('不能包含二维要素')
    expect(controller.signal.aborted).toBe(false)
    expect(useProjectStore.getState()).toBe(state)
    expect(useLayerViewStore.getState()).toBe(session)
    expect(featureData.readSnapshot()).toBe(rows)
    expect(projectEdits.getState()).toBe(history)
  })

  it('restores Provider baselines with pending overlays instead of treating effective rows as a new source', async () => {
    featureCommands.updateProperties('layer', 'row', { value: 9 })
    const captured = projectSession.getSnapshot(), sessions = featureData.captureActiveSessions()
    expect(sessions.old.source[0].properties.value).toBe(1)
    expect(captured.featuresByDataset.old[0].properties.value).toBe(9)
    projectSession.loadSnapshot(captured)
    expect(await featureData.readSource('old')).toEqual([{ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 9 } }])
    expect(featureData.pendingCount()).toBe(0)
    projectSession.loadSnapshot(captured, sessions)
    expect(await featureData.readSource('old')).toEqual([{ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }])
    expect(featureData.getById('old', 'row')?.properties.value).toBe(9)
    expect(featureData.pendingCount()).toBe(1)
    expect(featureData.getEditState().unsavedCount).toBe(1)
  })

  it('rejects uncloneable incoming data before changing the current owner or recovery-visible content', () => {
    featureCommands.updateProperties('layer', 'row', { value: 4 })
    const controller = new AbortController()
    useLayerViewStore.getState().setWfsAbort('layer', controller)
    const state = useProjectStore.getState(), rows = featureData.readSnapshot(), history = projectEdits.getState()
    const next = snapshot('next'); next.featuresByDataset.next[0].properties.invalid = () => undefined
    expect(() => projectSession.loadSnapshot(next)).toThrow()
    expect(controller.signal.aborted).toBe(false)
    expect(useProjectStore.getState()).toBe(state)
    expect(featureData.readSnapshot()).toBe(rows)
    expect(projectEdits.getState()).toBe(history)
    expect(projectSession.getSnapshot().featuresByDataset.old[0].properties.value).toBe(4)
  })
})
