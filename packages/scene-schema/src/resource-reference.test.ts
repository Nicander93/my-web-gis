import { expect, it } from 'vitest'
import { createCityScene } from '@desktop-webgis/cesium-scene-schema'
import { migrateSceneDocument, parseSceneDocument } from './document'

it('round trips native local identity through v1/v2 city migration and v3 without manufacturing a URL', () => {
  for (const version of [1, 2] as const) {
    const city = createCityScene(); city.version = version
    city.assets.model = { type: 'glb', reference: { kind: 'relative', path: 'models/model.glb' } }
    city.assets.vector = { type: 'geojson', reference: { kind: 'relative', path: '数据/points.geojson' } }
    city.nodes = [{ type: 'model', id: 'building', name: 'Building', visible: true, asset: 'model', position: [116, 39, 0],
      transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }]
    const document = migrateSceneDocument(city)
    const restored = parseSceneDocument(JSON.stringify(document))
    expect(restored.resources.model).toEqual({ type: 'glb', reference: { kind: 'relative', path: 'models/model.glb' } })
    expect(restored.nodes[0]).toMatchObject({ id: 'building', resource: 'model' })
    expect(restored.resources.model).not.toHaveProperty('url')
    expect(restored.resources.vector).toEqual(city.assets.vector)
  }
})
