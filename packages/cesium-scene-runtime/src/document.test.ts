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
  it('projects shared XYZ tiles and GeoJSON vectors into the city scene', () => {
    const input = document()
    input.resources.base = { type: 'xyz', url: 'https://example.test/{z}/{x}/{y}.png', attribution: 'Example' }
    input.resources.points = { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'A' }, geometry: { type: 'Point', coordinates: [116.4, 39.9] } }] } }
    input.nodes.push(
      { type: 'tile', id: 'map-base', name: 'Map base', resource: 'base', visible: true },
      { type: 'vector', id: 'points', name: 'Points', resource: 'points', visible: true, style: { mode: 'single', symbol: { type: 'circle', radius: 4, fill: { r: 255, g: 0, b: 0, a: 1 } } } }
    )
    const before = JSON.stringify(input)
    const result = projectCesiumDocument(input)
    expect(result.issues.filter(issue => issue.code === 'cesium.unsupported')).toEqual([])
    expect(result.document).toEqual(input)
    expect(JSON.stringify(input)).toBe(before)
    expect(result.scene.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'imagery', id: 'map-base', url: 'https://example.test/{z}/{x}/{y}.png', attribution: 'Example', visible: true }),
      expect.objectContaining({ type: 'geojson', id: 'points', asset: 'points', color: '#ff0000', visible: true }),
      expect.objectContaining({ type: '3dtiles', id: 'blocks' })
    ]))
    expect(result.scene.assets.points).toMatchObject({ type: 'geojson' })
    expect(result.scene.assets.points.data).toBeDefined()
  })

  it('keeps unsupported tile providers in the document without projecting them', () => {
    const input = document()
    input.resources.service = { type: 'wms', url: 'https://example.test/wms', version: '1.3.0', layerNames: ['L'], authMode: 'none' }
    input.nodes.push({ type: 'tile', id: 'wms', name: 'WMS', resource: 'service', visible: true })
    const result = projectCesiumDocument(input)
    expect(result.issues).toContainEqual(expect.objectContaining({ path: '$.nodes.wms', code: 'cesium.unsupported' }))
    expect(result.document.nodes.some(node => node.id === 'wms')).toBe(true)
    expect(result.scene.nodes.some(node => node.id === 'wms')).toBe(false)
  })
  it('rejects unsupported required extensions before projecting native content', () => {
    const input = document()
    input.extensions = { 'example.required': { version: 1, required: true, data: {} } }
    expect(() => projectCesiumDocument(input)).toThrow('example.required')
  })
})
