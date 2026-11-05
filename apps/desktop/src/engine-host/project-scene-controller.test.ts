import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/project/project-session'
import { featureCommands } from '@/commands/feature.commands'
import { projectEdits } from '@/project/project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { selectionCommands } from '@/commands/selection.commands'
import { requireMapContent, UpdateGeometryCommand } from '@desktop-webgis/project'
import { getLayerCapabilities } from '@/commands/layer.commands'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject } from '@desktop-webgis/project'
import { createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import type { SceneController } from '@desktop-webgis/scene-core'
import { commitProjectConfiguration, useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { createProjectSceneController } from './project-scene-controller'

const attached: SceneController[] = []
function attach() { const controller = createProjectSceneController(); attached.push(controller); return controller }
beforeEach(() => projectSession.loadSnapshot({ project: createProject('Host project'), featuresByDataset: {} }))
afterEach(() => { attached.splice(0).forEach(controller => controller.dispose()) })

describe('Project-owned public scene controller', () => {
  it('maps public nested scene moves back to host identities for locked history replay', () => {
    const project = createProject('Nested scene', 'scene3d'), scene = createCesiumScene()
    scene.assets.asset = { type: 'glb', url: './model.glb' }
    scene.groups = [{ id: 'outer', name: 'Outer', visible: true }, { id: 'inner', name: 'Inner', visible: true, parentId: 'outer' }]
    scene.nodes = ['a', 'b'].map(id => ({ id, name: id, type: 'model' as const, visible: true, groupId: 'inner', asset: 'asset', position: [0, 0, 0], transform: createTransform() }))
    project.content.scene = scene; projectSession.loadSnapshot({ project, featuresByDataset: {} })
    const controller = attach(), document = controller.getDocument()
    const node = document.nodes.find(node => node.name === 'a')!, parent = document.nodes.find(node => node.name === 'Inner')!
    controller.moveNode(node.id, document.nodes.length - 1, parent.id)
    expect(useProjectStore.getState().project.content.scene!.nodes.map(node => node.id)).toEqual(['b', 'a'])
    expect(projectEdits.undo()).toBe(true); expect(projectEdits.redo()).toBe(true)
    const locked = structuredClone(useProjectStore.getState().project)
    locked.content.scene!.nodes.find(node => node.id === 'a')!.locked = true
    commitProjectConfiguration(locked)
    const history = projectEdits.getState()
    expect(projectEdits.undo()).toBe(false); expect(projectEdits.getState()).toBe(history)
    expect(() => controller.moveNode(node.id, 2, parent.id)).toThrow('锁定')
  })

  it('retains public root move targets for execution and history without locking displaced siblings', () => {
    for (const id of ['first', 'second']) layerContentCommands.addLayer(id, id, [], 'point')
    const ids = requireMapContent(useProjectStore.getState().project).rootOrder.filter(entry => entry.type === 'layer').map(entry => entry.id)
    const controller = attach()
    layerConfigurationCommands.setLayerLocked(ids[0], true)
    const rows = featureData.readSnapshot()
    expect(() => controller.moveNode(ids[0], 1)).toThrow('锁定')
    controller.moveNode(ids[1], controller.getDocument().nodes.length - 1)
    expect(requireMapContent(useProjectStore.getState().project).rootOrder[0].id).toBe(ids[1])
    expect(projectEdits.undo()).toBe(true)
    expect(projectEdits.redo()).toBe(true)
    const project = structuredClone(useProjectStore.getState().project)
    requireMapContent(project).layers.find(layer => layer.id === ids[1])!.locked = true
    // 外部的配置变化必须在重放时、消耗历史之前检查。
    commitProjectConfiguration(project)
    const history = projectEdits.getState()
    expect(projectEdits.undo()).toBe(false); expect(projectEdits.getState()).toBe(history)
    expect(featureData.readSnapshot()).toBe(rows)
  })

  it('guards opaque public root reorder transactions against displaced locked objects', () => {
    for (const id of ['first', 'second']) layerContentCommands.addLayer(id, id, [], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id
    layerConfigurationCommands.setLayerLocked(id, true)
    const controller = attach(), state = useProjectStore.getState(), history = projectEdits.getState()
    expect(() => controller.transaction('Raw reorder', draft => { draft.nodes.reverse() })).toThrow('锁定')
    expect(useProjectStore.getState()).toBe(state); expect(projectEdits.getState()).toBe(history)
  })

  it('uses public map local locks for configuration and row permissions with reversible unlocks', () => {
    layerContentCommands.addLayer('data', 'Data', [{ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }], 'point')
    projectEdits.clear()
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id, controller = attach()
    const rows = featureData.readSnapshot(), revision = featureData.revision
    expect(requireMapContent(useProjectStore.getState().project).layers[0].editable).toBe(false)
    expect(getLayerCapabilities(id).canEditGeometry).toBe(true)
    controller.setNodeLocked(id, true)
    expect(requireMapContent(useProjectStore.getState().project).layers[0]).toMatchObject({ editable: false, locked: true })
    expect(getLayerCapabilities(id)).toMatchObject({ canEditGeometry: false, canStyle: false, canFilter: false, canRename: false })
    expect(() => controller.setNodeOpacity(id, .4)).toThrow('锁定')
    expect(featureCommands.updateProperties(id, 'row', { value: 2 })).toBe(false)
    expect(() => projectEdits.execute(new UpdateGeometryCommand('blocked', 'data', 'row', { type: 'Point', coordinates: [0, 0] }, { type: 'Point', coordinates: [1, 2] }))).toThrow('锁定')
    controller.setNodeVisible(id, false)
    expect(projectEdits.undo()).toBe(true)
    expect(projectEdits.undo()).toBe(true)
    expect(getLayerCapabilities(id).canEditGeometry).toBe(true)
    expect(projectEdits.redo()).toBe(true)
    controller.setNodeLocked(id, false)
    expect(projectEdits.undo()).toBe(true)
    expect(getLayerCapabilities(id).canEditGeometry).toBe(false)
    expect(projectEdits.redo()).toBe(true)
    expect(getLayerCapabilities(id).canEditGeometry).toBe(true)
    const group = layerConfigurationCommands.createGroup('Parent', [id])!
    controller.setNodeLocked(id, true)
    layerConfigurationCommands.setGroupLocked(group, true)
    expect(() => controller.setNodeLocked(id, false)).toThrow('锁定')
    expect(() => layerConfigurationCommands.setLayerLocked(id, false)).toThrow('解锁父')
    expect(featureData.readSnapshot()).toBe(rows); expect(featureData.revision).toBe(revision)
  })

  it('commits public map configuration and its undo without replacing effective dataset rows', () => {
    layerContentCommands.addLayer('data', 'Data', [{ id: 'row', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 1 } }], 'point')
    projectEdits.clear()
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id, controller = attach()
    const rows = featureData.readSnapshot(), revision = featureData.revision
    const replace = vi.spyOn(featureData, 'replaceAll'), setAll = vi.spyOn(featureData, 'setAll')
    try {
      controller.setNodeOpacity(id, .4)
      expect(requireMapContent(useProjectStore.getState().project).layers[0].opacity).toBe(.4)
      expect(projectEdits.undo()).toBe(true)
      expect(requireMapContent(useProjectStore.getState().project).layers[0].opacity).toBe(1)
      expect(projectEdits.redo()).toBe(true)
      expect(replace).not.toHaveBeenCalled(); expect(setAll).not.toHaveBeenCalled()
    } finally { replace.mockRestore(); setAll.mockRestore() }
    expect(featureData.readSnapshot()).toBe(rows); expect(featureData.revision).toBe(revision)
  })

  it('protects parent locks for public configuration and still permits visibility changes', () => {
    layerContentCommands.addLayer('data', 'Data', [], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id
    const group = layerConfigurationCommands.createGroup('Locked', [id])!
    layerConfigurationCommands.setGroupLocked(group, true)
    const controller = attach(), state = useProjectStore.getState(), history = projectEdits.getState(), rows = featureData.readSnapshot()
    expect(() => controller.setNodeOpacity(id, .4)).toThrow('锁定')
    expect(useProjectStore.getState()).toBe(state); expect(projectEdits.getState()).toBe(history)
    expect(featureData.readSnapshot()).toBe(rows)
    controller.setNodeVisible(id, false)
    expect(requireMapContent(useProjectStore.getState().project).layers[0].visible).toBe(false)
    expect(featureData.readSnapshot()).toBe(rows)
    expect(projectEdits.undo()).toBe(true)
  })

  it('rejects cross-workspace API content before changing the document or undo history', () => {
    const controller = attach(), store = useProjectStore.getState(), before = projectSession.getSnapshot()
    expect(() => controller.addTileset({ id: 'wrong-scope', name: 'Wrong workspace', url: './tileset.json' })).toThrow('工作区')
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.canUndo()).toBe(false)
    expect(controller.getDocument().nodes.some(node => node.id === 'wrong-scope')).toBe(false)
  })
  it('keeps original scene object, group and asset identities in the scene workspace', () => {
    const before = { project: createProject('Scene', 'scene3d'), featuresByDataset: {} }, id = 'object'
    before.project.content.scene = createCesiumScene()
    before.project.content.scene.assets.data = { type: 'glb', url: './model.glb' }
    before.project.content.scene.groups = [{ id: 'group', name: 'Scene group', visible: true }]
    before.project.content.scene.nodes = [{ id, type: 'model', name: 'Scene object', visible: true, asset: 'data', groupId: 'group', position: [0, 0, 0], transform: createTransform() }]
    projectSession.loadSnapshot(before)
    const controller = attach(), document = controller.getDocument()
    const model = document.nodes.find(node => node.type === 'model')!
    controller.setNodeVisible(model.id, false)
    expect(useProjectStore.getState().project.content.scene?.nodes[0]).toMatchObject({ id, asset: 'data', groupId: 'group', visible: false })
    expect(useProjectStore.getState().project.content.scene?.groups?.[0].id).toBe('group')
    expect(Object.keys(useProjectStore.getState().project.content.scene!.assets)).toEqual(['data'])
    expect(controller.getDocument().nodes.find(node => node.type === 'model')?.id).toBe(model.id)
    expect(useProjectStore.getState().project.content).not.toHaveProperty('layers')
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.redo()).toBe(true)
    expect(useProjectStore.getState().project.content.scene?.nodes[0].id).toBe(id)
  })
  it('applies immediate styles through the scene API while preserving table sessions and history', () => {
    layerContentCommands.addLayer('points', 'Points', [], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id, controller = attach(), session = useLayerViewStore.getState()
    session.setAttributeTableState(id, { searchQuery: 'keep' })
    controller.transaction('Style API', draft => {
      const node = draft.nodes.find(node => node.id === id)
      if (node?.type === 'vector') node.style = { mode: 'single', symbol: { type: 'circle', radius: 9 } }
    })
    const after = projectSession.getSnapshot()
    expect(requireMapContent(after.project).layers[0].style).toMatchObject({ symbol: { radius: 9 } })
    expect(useLayerViewStore.getState().sessions[id].attributeTable?.searchQuery).toBe('keep')
    expect(projectEdits.getBlockReason('undo')).toBeNull()
    expect(projectEdits.undo()).toBe(true)
    expect(useLayerViewStore.getState().sessions[id].attributeTable?.searchQuery).toBe('keep')
    expect(projectEdits.redo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(after)
  })
  it('clears deleted layer targets while preserving another layer session', () => {
    layerContentCommands.addLayer('a', 'A', [], 'point'); layerContentCommands.addLayer('b', 'B', [], 'point')
    const [a, b] = requireMapContent(useProjectStore.getState().project).layers, controller = attach()
    useLayerViewStore.getState().setSelectedLayer(a.id)
    useWorkbenchStore.getState().bindTable(a.id); useWorkbenchStore.getState().bindInspector(a.id)
    useLayerViewStore.getState().setAttributeTableState(a.id, { searchQuery: 'delete' })
    useLayerViewStore.getState().setAttributeTableState(b.id, { searchQuery: 'retain' })
    const retained = structuredClone(useLayerViewStore.getState().sessions[b.id])
    controller.removeNode(a.id)
    expect(useLayerViewStore.getState().selectedLayerId).toBeNull()
    expect(useWorkbenchStore.getState().tableLayerId).toBeNull()
    expect(useWorkbenchStore.getState().inspectorLayerId).toBeNull()
    expect(useLayerViewStore.getState().sessions[a.id]).toBeUndefined()
    expect(useLayerViewStore.getState().sessions[b.id]).toEqual(retained)
    projectEdits.undo()
    expect(requireMapContent(useProjectStore.getState().project).layers.some(layer => layer.id === a.id)).toBe(true)
    expect(useLayerViewStore.getState().sessions[b.id]).toEqual(retained)
  })
  it('retains selection, table target and search for display edits and undo', () => {
    layerContentCommands.addLayer('points', 'Points', [{ id: 'p', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id, controller = attach()
    const session = useLayerViewStore.getState(), workbench = useWorkbenchStore.getState()
    useLayerViewStore.getState().setSelectedLayer(id); selectionCommands.setSelection({ layerId: id, featureIds: ['p'] })
    workbench.bindTable(id); workbench.bindInspector(id)
    session.setAttributeTableState(id, { searchQuery: 'keep', currentPage: 3 })
    const before = structuredClone(useLayerViewStore.getState().sessions)
    controller.setNodeOpacity(id, 0.6)
    expect(useLayerViewStore.getState().selection).toEqual({ layerId: id, featureIds: ['p'] })
    expect(useLayerViewStore.getState().selectedLayerId).toBe(id)
    expect(useWorkbenchStore.getState().tableLayerId).toBe(id)
    expect(useLayerViewStore.getState().sessions).toEqual(before)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers[0].opacity).toBe(1)
    expect(useLayerViewStore.getState().sessions).toEqual(before)
    expect(projectEdits.redo()).toBe(true)
  })
  it('does not overwrite a later unrelated feature refresh when an API display edit is undone', () => {
    layerContentCommands.addLayer('points', 'Points', [{ id: 'p', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id, controller = attach()
    controller.setNodeOpacity(id, 0.6)
    featureCommands.replaceDatasetFeatures('points', [{ id: 'new', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { value: 2 } }])
    projectEdits.undo()
    expect(featureData.readSnapshot().points[0].id).toBe('new')
    expect(requireMapContent(useProjectStore.getState().project).layers[0].opacity).toBe(1)
  })
  it('exports API-created objects from Project content and uses one existing undo/redo entry', () => {
    projectSession.loadSnapshot({ project: createProject('Scene', 'scene3d'), featuresByDataset: {} })
    const controller = attach(), observer = vi.fn()
    controller.subscribe(observer)
    const before = projectSession.getSnapshot()
    controller.addTileset({ id: 'blocks', name: 'Blocks', url: './city/tileset.json' })
    expect(useProjectStore.getState().project.content.scene?.nodes).toContainEqual(expect.objectContaining({ id: 'blocks', type: '3dtiles' }))
    expect(JSON.parse(controller.exportJson()).nodes).toContainEqual(expect.objectContaining({ id: 'blocks', resource: 'blocks:resource' }))
    expect(observer).toHaveBeenCalledOnce()
    projectEdits.undo()
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(controller.getDocument().nodes.some(node => node.id === 'blocks')).toBe(false)
    expect(projectEdits.canUndo()).toBe(false)
    projectEdits.redo()
    expect(controller.getDocument().nodes.some(node => node.id === 'blocks')).toBe(true)
  })
  it('observes existing project edits but 忽略s selection and dirty-state changes', () => {
    const controller = attach(), observer = vi.fn()
    controller.subscribe(observer)
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('points', 'Points', [], 'point')
    const layerId = requireMapContent(useProjectStore.getState().project).layers[0].id
    expect(controller.getDocument().nodes.some(node => node.id === layerId)).toBe(true)
    observer.mockClear()
    useLayerViewStore.getState().setSelectedLayer(layerId); store.setDirty(false); selectionCommands.clearSelection()
    expect(observer).not.toHaveBeenCalled()
    layerConfigurationCommands.setLayerOpacity(layerId, 0.5)
    expect(controller.getDocument().nodes.find(node => node.id === layerId)).toMatchObject({ opacity: 0.5 })
    expect(observer).toHaveBeenCalledOnce()
  })
  it('preserves unchanged local origins and settings through API edits and prior history', () => {
    const initial = projectSession.getSnapshot()
    initial.project.content.settings.customWorkflow = { snap: true }
    projectSession.loadSnapshot(initial)
    layerContentCommands.addLayer('points', 'Points', [{ id: 'p', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }], 'point')
    const snapshot = projectSession.getSnapshot()
    requireMapContent(snapshot.project).datasets[0].source = { type: 'geojson-file', path: 'C:/private/source.geojson' }
    projectSession.loadSnapshot(snapshot)
    const id = requireMapContent(snapshot.project).layers[0].id
    layerConfigurationCommands.setLayerOpacity(id, 0.6)
    const controller = attach()
    controller.setNodeVisible(id, false)
    expect(requireMapContent(useProjectStore.getState().project).datasets[0].source).toEqual(requireMapContent(snapshot.project).datasets[0].source)
    expect(useProjectStore.getState().project.content.settings.customWorkflow).toEqual({ snap: true })
    expect(controller.exportJson()).not.toContain('C:/private')
    const reordered = controller.getDocument()
    reordered.resources.points = Object.fromEntries(Object.entries(reordered.resources.points).reverse()) as typeof reordered.resources.points
    const beforeReorder = projectSession.getSnapshot()
    controller.replaceDocument(reordered)
    expect(projectSession.getSnapshot()).toEqual(beforeReorder)
    expect(requireMapContent(useProjectStore.getState().project).datasets[0].source).toEqual(requireMapContent(snapshot.project).datasets[0].source)
    projectEdits.undo()
    expect(requireMapContent(useProjectStore.getState().project).layers[0]).toMatchObject({ visible: true, opacity: 0.6 })
    projectEdits.undo()
    expect(requireMapContent(useProjectStore.getState().project).layers[0].opacity).toBe(1)
  })
  it('rejects unsupported edits before changing Project or history', () => {
    layerContentCommands.addLayer('points', 'Points', [], 'point')
    const history = projectEdits.getState()
    const controller = attach(), before = projectSession.getSnapshot()
    const document = controller.getDocument()
    document.extensions = { 'org.example.future': { version: 1, required: true, data: {} } }
    expect(() => controller.replaceDocument(document)).toThrow('扩展')
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.getState()).toBe(history)
  })
  it('commits scene metadata and display content through project history', () => {
    const controller = attach()
    controller.transaction('Configure scene presentation', document => {
      document.description = 'Survey workspace'
      document.metadata = { revision: 0, tags: ['survey'] }
      document.widgets = { legend: false }
      document.theme = { colorScheme: 'dark' }
    })
    expect(useProjectStore.getState().project).toMatchObject({ metadata: { description: 'Survey workspace', sceneMetadata: { revision: 0 } }, content: { display: { widgets: { legend: false }, theme: { colorScheme: 'dark' } } } })
    projectEdits.undo()
    expect(controller.getDocument().metadata).toBeUndefined()
    expect(controller.getDocument().widgets).toBeUndefined()
    projectEdits.redo()
    expect(controller.getDocument().metadata).toEqual({ revision: 0, tags: ['survey'] })
    expect(controller.getDocument().theme).toEqual({ colorScheme: 'dark' })
  })
})
