import { describe, expect, it } from 'vitest'
import { createCityScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { migrateSceneDocument } from '@desktop-webgis/scene-schema'
import { projectCesiumDocument } from './document.js'

function document() {
  const city = createCityScene()
  city.assets.blocks = { type: '3dtiles', url: './city/tileset.json' }
  city.nodes.push({ type: '3dtiles', id: 'blocks', name: 'Blocks', visible: true, asset: 'blocks', transform: createTransform(), maximumScreenSpaceError: 2, cacheBytes: 512 * 1024 * 1024 })
  return migrateSceneDocument(city)
}

describe('v3 Cesium projection', () => {
  it('retains original local states while deriving nested group state for the renderer', () => {
    const input = document()
    input.nodes.unshift({ type: 'group', id: 'outer', name: 'Outer', visible: false, locked: true, scope: '3d' }, { type: 'group', id: 'inner', name: 'Inner', visible: true, parentId: 'outer', scope: '3d' })
    input.nodes[2].parentId = 'inner'
    const before = JSON.stringify(input), result = projectCesiumDocument(input)
    expect(result.scene.nodes[0]).toMatchObject({ id: 'blocks', visible: false, locked: true, maximumScreenSpaceError: 2, cacheBytes: 512 * 1024 * 1024, asset: 'blocks' })
    expect(result.scene.camera).toEqual(input.views.city.type === '3d' ? input.views.city.camera : undefined)
    expect(result.document).toEqual(input)
    expect(JSON.stringify(input)).toBe(before)
    input.nodes[0].visible = true; input.nodes[0].locked = false
    expect(projectCesiumDocument(input).scene.nodes[0]).toMatchObject({ visible: true, locked: false })
  })
  it('reports shared map nodes and retains them in the full document', () => {
    const input = document()
    input.resources.base = { type: 'xyz', url: 'https://example.test/{z}/{x}/{y}.png' }
    input.nodes.push({ type: 'tile', id: 'map-base', name: 'Map base', resource: 'base' })
    const result = projectCesiumDocument(input)
    expect(result.issues).toContainEqual(expect.objectContaining({ path: '$.nodes.map-base', code: 'cesium.unsupported' }))
    expect(result.document).toEqual(input)
    expect(result.scene.nodes).toHaveLength(1)
  })
  it('rejects unsupported required extensions before projecting native content', () => {
    const input = document()
    input.extensions = { 'example.required': { version: 1, required: true, data: {} } }
    expect(() => projectCesiumDocument(input)).toThrow('example.required')
  })
})
