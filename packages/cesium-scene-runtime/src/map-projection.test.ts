import { describe, expect, it } from 'vitest'
import { createCityScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { migrateSceneDocument } from '@desktop-webgis/scene-schema'
import { projectCesiumDocument } from './document.js'

describe('frozen map co-rendering', () => {
  it('retains map content while preserving native city nodes using the same GeoJSON resource', () => {
    const city = createCityScene()
    const data = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { value: 2 }, geometry: { type: 'Point', coordinates: [116.4, 39.9] } }] }
    city.assets.points = { type: 'geojson', url: './city/points.geojson' }
    city.assets.blocks = { type: '3dtiles', url: './city/tileset.json' }
    city.assets.model = { type: 'glb', url: './city/model.glb' }
    city.nodes.push(
      { type: 'geojson', id: 'native-points', name: 'City points', visible: true, asset: 'points', color: '#123456' },
      { type: '3dtiles', id: 'blocks', name: 'Blocks', visible: true, asset: 'blocks', transform: createTransform() },
      { type: 'model', id: 'model', name: 'Model', visible: true, asset: 'model', position: [116.4, 39.9, 0], transform: createTransform() },
      { type: 'imagery', id: 'native-imagery', name: 'City imagery', visible: true, url: 'https://example.test/native/{z}/{x}/{y}.png' }
    )
    const input = migrateSceneDocument(city)
    input.resources.snapshot = { type: 'wfs', url: 'https://example.test/wfs', typeName: 'points', version: '2.0.0', authMode: 'none', snapshot: data }
    input.resources.base = { type: 'xyz', url: 'https://example.test/map/{z}/{x}/{y}.png' }
    input.nodes.push(
      { type: 'vector', id: 'map-points', name: 'Map points', visible: true, resource: 'points', style: { mode: 'single', symbol: { type: 'circle', radius: 3 } }, filter: [{ field: 'value', op: 'eq', value: 1 }], interaction: { selectable: false, popup: { fields: [{ field: 'value' }] } } },
      { type: 'vector', id: 'map-snapshot', name: 'Map snapshot', visible: true, resource: 'snapshot', style: { mode: 'single', symbol: { type: 'circle', radius: 3 } } },
      { type: 'tile', id: 'map-base', name: 'Map imagery', visible: true, resource: 'base' }
    )
    const before = structuredClone(input)
    const result = projectCesiumDocument(input)
    expect(result.document).toEqual(before)
    expect(input).toEqual(before)
    expect(result.scene.nodes.map(node => node.id)).toEqual(city.nodes.map(node => node.id))
    expect(result.scene.nodes[0]).toMatchObject({ type: 'geojson', color: '#123456', asset: 'points' })
    expect(result.scene.assets.points.url).toBe('./city/points.geojson')
    expect(result.issues.map(issue => issue.path)).toEqual(['$.nodes.map-points', '$.nodes.map-snapshot', '$.nodes.map-base'])

    // Updating map filters/visibility must not change the city projection or source data.
    const vector = input.nodes.find(node => node.id === 'map-points')
    if (!vector || vector.type !== 'vector') throw new Error('expected map vector')
    vector.visible = false
    vector.filter = [{ field: 'value', op: 'eq', value: 2 }]
    expect(projectCesiumDocument(input).scene).toEqual(result.scene)
  })
})
