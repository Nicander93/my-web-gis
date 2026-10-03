import { describe, expect, it } from 'vitest'
import { parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/gis-core'
import { createCityScene } from '@desktop-webgis/cesium-scene-schema'
import { createEditorProject, getProjectType } from './project-type'

describe('persisted editor workspace type', () => {
  it('reopens an empty 3D project in 3D before any resource is added', () => {
    const project = createEditorProject('3d', '中心城区')
    const restored = parseProjectSnapshot(serializeProjectSnapshot({ project, featuresByDataset: {} })).project
    expect(getProjectType(restored)).toBe('3d')
    expect(restored.city?.nodes).toEqual([])
    expect(restored.name).toBe('中心城区')
  })
  it('keeps the project type after removing the last scene object', () => {
    const project = createEditorProject('3d', '')
    project.city = undefined
    const restored = parseProjectSnapshot(serializeProjectSnapshot({ project, featuresByDataset: {} })).project
    expect(getProjectType(restored)).toBe('3d')
  })
  it('recognizes legacy projects without editor settings', () => {
    const project = createEditorProject('2d', '旧工程')
    project.settings = {}
    expect(getProjectType(project)).toBe('2d')
    project.city = createCityScene()
    expect(getProjectType(project)).toBe('3d')
  })
  it('preserves an explicit 2D workspace when legacy city data exists', () => {
    const project = createEditorProject('2d', '地图')
    project.city = createCityScene()
    expect(getProjectType(project)).toBe('2d')
  })
})
