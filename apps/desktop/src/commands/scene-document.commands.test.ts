import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/project'
import { createSceneDocument } from '@desktop-webgis/scene-core'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { createProjectSceneDocument } from '@/io/project-scene-document'
import { replaceSceneDocumentAsEdit } from './scene-document.commands'

beforeEach(() => projectSession.loadSnapshot({ project: createProject('Old'), featuresByDataset: {} }))

describe('scene content import in shared project history', () => {
  it('replaces complete project and features with one undo and redo', () => {
    const before = projectSession.getSnapshot()
    const document = createSceneDocument({ id: 'new', title: 'Imported', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 3 } })
    document.resources.points = { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'p', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { value: 5 } }] } }
    document.nodes.push({ type: 'vector', id: 'points', name: 'Points', resource: 'points', style: { mode: 'single', symbol: { type: 'circle', radius: 4 } } })
    expect(replaceSceneDocumentAsEdit(document)).toBe(true)
    const imported = projectSession.getSnapshot()
    expect(imported.featuresByDataset.points[0].properties.value).toBe(5)
    expect(useProjectStore.getState().dirty).toBe(true)
    projectEdits.undo()
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.canUndo()).toBe(false)
    projectEdits.redo()
    expect(projectSession.getSnapshot()).toEqual(imported)
  })
  it('rejects unsupported document content before altering project, selection or history', () => {
    const before = projectSession.getSnapshot(), document = createProjectSceneDocument(before)
    document.extensions = { 'example.required': { version: 1, required: true, data: {} } }
    expect(() => replaceSceneDocumentAsEdit(document)).toThrow('扩展')
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(projectEdits.canUndo()).toBe(false)
  })
  it('preserves earlier edit history rather than clearing it during scene replacement', () => {
    layerContentCommands.addLayer('old-data', 'Old layer', [{ id: 'old', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id
    layerConfigurationCommands.setLayerOpacity(id, 0.5)
    const before = projectSession.getSnapshot(), document = createProjectSceneDocument(before)
    document.title = 'Replacement'
    replaceSceneDocumentAsEdit(document)
    projectEdits.undo()
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.canUndo()).toBe(true)
    projectEdits.undo()
    expect(requireMapContent(useProjectStore.getState().project).layers[0].opacity).toBe(1)
  })
  it('cancels stale WFS loads on replacement and each content undo', () => {
    const controller = new AbortController(), generation = useLayerViewStore.getState().wfsLoadGeneration
    useLayerViewStore.setState({ wfsAbortByLayer: { old: controller } })
    const document = createProjectSceneDocument(projectSession.getSnapshot())
    document.title = 'Next scene'
    replaceSceneDocumentAsEdit(document)
    expect(controller.signal.aborted).toBe(true)
    expect(useLayerViewStore.getState().wfsLoadGeneration).toBe(generation + 1)
    projectEdits.undo()
    expect(useLayerViewStore.getState().wfsLoadGeneration).toBe(generation + 2)
  })
  it('resets same-ID inspector and table sessions when content is replaced, undone or loaded', () => {
    layerContentCommands.addLayer('data', 'Old layer', [{ id: 'old', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }], 'point')
    const before = projectSession.getSnapshot()
    const layer = requireMapContent(before.project).layers[0]
    const session = useLayerViewStore.getState()
    session.setAttributeTableState(layer.id, { searchQuery: 'old-content', currentPage: 8, selectedOnly: true })
    const document = createProjectSceneDocument(before)
    const node = document.nodes.find(node => node.id === layer.id)
    if (!node || node.type !== 'vector') throw new Error('Expected vector')
    node.style = { mode: 'single', symbol: { type: 'circle', radius: 9 } }
    replaceSceneDocumentAsEdit(document)
    expect(useLayerViewStore.getState().sessions).toEqual({})
    projectEdits.undo()
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(useLayerViewStore.getState().sessions).toEqual({})
    useLayerViewStore.getState().setAttributeTableState(layer.id, { searchQuery: 'stale' })
    projectSession.loadSnapshot(before)
    expect(useLayerViewStore.getState().sessions).toEqual({})
  })
  it('restores immediate style edits after full replacement and through undo/redo', () => {
    layerContentCommands.addLayer('data', 'Layer', [], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id
    layerConfigurationCommands.setLayerStyle(id, { mode: 'single', symbol: { type: 'circle', radius: 7 } })
    const before = projectSession.getSnapshot()
    const document = createProjectSceneDocument(before)
    document.title = 'Next scene'
    expect(replaceSceneDocumentAsEdit(document)).toBe(true)
    const imported = projectSession.getSnapshot()
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.undo()).toBe(true)
    expect(requireMapContent(useProjectStore.getState().project).layers[0].style).not.toEqual(requireMapContent(before.project).layers[0].style)
    expect(projectEdits.redo()).toBe(true)
    expect(projectEdits.redo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(imported)
  })
})
