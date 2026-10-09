import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import type { SceneController } from '@desktop-webgis/scene-core'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { createProjectSceneController } from './project-scene-controller'

const attached: SceneController[] = []
function attach() { const controller = createProjectSceneController(); attached.push(controller); return controller }
beforeEach(() => useProjectStore.getState().loadSnapshot({ project: createProject('Host project'), featuresByDataset: {} }))
afterEach(() => { attached.splice(0).forEach(controller => controller.dispose()) })

describe('Project-owned public scene controller', () => {
  it('exports API-created objects from Project content and uses one existing undo/redo entry', () => {
    const controller = attach(), observer = vi.fn()
    controller.subscribe(observer)
    const before = useProjectStore.getState().getSnapshot()
    controller.addTileset({ id: 'blocks', name: 'Blocks', url: './city/tileset.json' })
    expect(useProjectStore.getState().project.city?.nodes).toContainEqual(expect.objectContaining({ id: 'blocks', type: '3dtiles' }))
    expect(JSON.parse(controller.exportJson()).nodes).toContainEqual(expect.objectContaining({ id: 'blocks', resource: 'blocks:resource' }))
    expect(observer).toHaveBeenCalledOnce()
    useProjectStore.getState().undoEdit()
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(controller.getDocument().nodes.some(node => node.id === 'blocks')).toBe(false)
    expect(useProjectStore.getState().canUndoEdit()).toBe(false)
    useProjectStore.getState().redoEdit()
    expect(controller.getDocument().nodes.some(node => node.id === 'blocks')).toBe(true)
  })
  it('observes existing project edits but ignores selection and dirty-state changes', () => {
    const controller = attach(), observer = vi.fn()
    controller.subscribe(observer)
    const store = useProjectStore.getState()
    store.addLayer('points', 'Points', [], 'point')
    const layerId = useProjectStore.getState().project.layers[0].id
    expect(controller.getDocument().nodes.some(node => node.id === layerId)).toBe(true)
    observer.mockClear()
    store.setSelectedLayer(layerId); store.setDirty(false); store.clearSelection()
    expect(observer).not.toHaveBeenCalled()
    store.setLayerOpacity(layerId, 0.5)
    expect(controller.getDocument().nodes.find(node => node.id === layerId)).toMatchObject({ opacity: 0.5 })
    expect(observer).toHaveBeenCalledOnce()
  })
  it('preserves unchanged local origins and settings through API edits and prior history', () => {
    const initial = useProjectStore.getState().getSnapshot()
    initial.project.settings.customWorkflow = { snap: true }
    useProjectStore.getState().loadSnapshot(initial)
    useProjectStore.getState().addLayer('points', 'Points', [{ id: 'p', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }], 'point')
    const snapshot = useProjectStore.getState().getSnapshot()
    snapshot.project.datasets[0].source = { type: 'geojson-file', path: 'C:/private/source.geojson' }
    useProjectStore.getState().loadSnapshot(snapshot)
    const id = snapshot.project.layers[0].id
    useProjectStore.getState().setLayerOpacity(id, 0.6)
    const controller = attach()
    controller.setNodeVisible(id, false)
    expect(useProjectStore.getState().project.datasets[0].source).toEqual(snapshot.project.datasets[0].source)
    expect(useProjectStore.getState().project.settings.customWorkflow).toEqual({ snap: true })
    expect(controller.exportJson()).not.toContain('C:/private')
    const reordered = controller.getDocument()
    reordered.resources.points = Object.fromEntries(Object.entries(reordered.resources.points).reverse()) as typeof reordered.resources.points
    controller.replaceDocument(reordered)
    expect(useProjectStore.getState().project.datasets[0].source).toEqual(snapshot.project.datasets[0].source)
    useProjectStore.getState().undoEdit()
    expect(useProjectStore.getState().project.layers[0]).toMatchObject({ visible: true, opacity: 0.6 })
    useProjectStore.getState().undoEdit()
    expect(useProjectStore.getState().project.layers[0].opacity).toBe(1)
  })
  it('honors draft guards and rejects unsupported edits before changing Project or history', () => {
    useProjectStore.getState().addLayer('points', 'Points', [], 'point')
    const id = useProjectStore.getState().project.layers[0].id, controller = attach()
    useSessionStore.getState().setStyleDraft(id, { style: { mode: 'single', symbol: { type: 'circle', radius: 5 } }, dirty: true, classCount: 5, colorRampId: 'BlueRed' })
    const before = useProjectStore.getState().getSnapshot()
    expect(() => controller.setNodeVisible(id, false)).toThrow('样式草稿')
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    useSessionStore.getState().patchStyleDraft(id, { dirty: false })
    const document = controller.getDocument(); document.metadata = { unsupported: true }
    expect(() => controller.replaceDocument(document)).toThrow('元数据')
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().canUndoEdit()).toBe(false)
  })
})
