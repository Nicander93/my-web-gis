import { describe, expect, it } from 'vitest'
import { parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/project'
import { createCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { createEditorProject, getProjectType } from './project-type'

describe('persisted editor workspace type', () => {
  it('reopens an empty 3D project in 3D before any resource is added', () => {
    const project = createEditorProject('3d', '中心城区')
    const restored = parseProjectSnapshot(serializeProjectSnapshot({ project, featuresByDataset: {} })).project
    expect(getProjectType(restored)).toBe('3d')
    expect(restored.content.scene?.nodes).toEqual([])
    expect(restored.metadata.name).toBe('中心城区')
  })
  it('keeps the project type after removing the last scene object', () => {
    const project = createEditorProject('3d', '')
    if (project.content.kind === 'scene3d') project.content.scene.nodes = []
    const restored = parseProjectSnapshot(serializeProjectSnapshot({ project, featuresByDataset: {} })).project
    expect(getProjectType(restored)).toBe('3d')
  })
  it('recognizes legacy projects without editor settings', () => {
    const legacy = { id: 'legacy', version: 1, name: '旧工程', crs: 'EPSG:3857', datasets: [], layers: [],
      mapState: { center: [0, 0], zoom: 2, rotation: 0 }, settings: {}, city: createCesiumScene() }
    expect(getProjectType(parseProjectSnapshot(JSON.stringify(legacy)).project)).toBe('3d')
  })
  it('preserves an explicit 2D workspace when legacy scene data exists', () => {
    const project = createEditorProject('2d', '地图')
    project.content.scene = createCesiumScene()
    expect(getProjectType(project)).toBe('2d')
  })
})
