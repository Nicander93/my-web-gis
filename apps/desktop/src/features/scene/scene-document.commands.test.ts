import { beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { createSceneDocument } from '@desktop-webgis/scene-core'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { createProjectSceneDocument } from './project-scene-document'
import { replaceSceneDocumentAsEdit } from './scene-document.commands'

beforeEach(() => useProjectStore.getState().loadSnapshot({ project: createProject('Old'), featuresByDataset: {} }))

describe('scene content import in shared project history', () => {
  it('replaces complete project and features with one undo and redo', () => {
    const before = useProjectStore.getState().getSnapshot()
    const document = createSceneDocument({ id: 'new', title: 'Imported', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 3 } })
    document.resources.points = { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'p', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { value: 5 } }] } }
    document.nodes.push({ type: 'vector', id: 'points', name: 'Points', resource: 'points', style: { mode: 'single', symbol: { type: 'circle', radius: 4 } } })
    expect(replaceSceneDocumentAsEdit(document)).toBe(true)
    const imported = useProjectStore.getState().getSnapshot()
    expect(imported.featuresByDataset.points[0].properties.value).toBe(5)
    expect(useProjectStore.getState().dirty).toBe(true)
    useProjectStore.getState().undoEdit()
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().canUndoEdit()).toBe(false)
    useProjectStore.getState().redoEdit()
    expect(useProjectStore.getState().getSnapshot()).toEqual(imported)
  })
  it('rejects unsupported document content before altering project, selection or history', () => {
    const before = useProjectStore.getState().getSnapshot(), document = createProjectSceneDocument(before)
    document.extensions = { 'example.required': { version: 1, required: true, data: {} } }
    expect(() => replaceSceneDocumentAsEdit(document)).toThrow('扩展')
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().dirty).toBe(false)
    expect(useProjectStore.getState().canUndoEdit()).toBe(false)
  })
  it('preserves earlier edit history rather than clearing it during scene replacement', () => {
    useProjectStore.getState().addLayer('old-data', 'Old layer', [{ id: 'old', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }], 'point')
    const id = useProjectStore.getState().project.layers[0].id
    useProjectStore.getState().setLayerOpacity(id, 0.5)
    const before = useProjectStore.getState().getSnapshot(), document = createProjectSceneDocument(before)
    document.title = 'Replacement'
    replaceSceneDocumentAsEdit(document)
    useProjectStore.getState().undoEdit()
    expect(useProjectStore.getState().getSnapshot()).toEqual(before)
    expect(useProjectStore.getState().canUndoEdit()).toBe(true)
    useProjectStore.getState().undoEdit()
    expect(useProjectStore.getState().project.layers[0].opacity).toBe(1)
  })
  it('cancels stale WFS loads on replacement and each content undo', () => {
    const controller = new AbortController(), generation = useSessionStore.getState().wfsLoadGeneration
    useSessionStore.setState({ wfsAbortByLayer: { old: controller } })
    const document = createProjectSceneDocument(useProjectStore.getState().getSnapshot())
    document.title = 'Next scene'
    replaceSceneDocumentAsEdit(document)
    expect(controller.signal.aborted).toBe(true)
    expect(useSessionStore.getState().wfsLoadGeneration).toBe(generation + 1)
    useProjectStore.getState().undoEdit()
    expect(useSessionStore.getState().wfsLoadGeneration).toBe(generation + 2)
  })
})
