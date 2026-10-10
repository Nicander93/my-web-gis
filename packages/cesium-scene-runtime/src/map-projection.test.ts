import { describe, expect, it } from 'vitest'
import { createCityScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { migrateSceneDocument } from '@desktop-webgis/scene-schema'
import { colorFromLayerStyle, projectCesiumDocument } from './document.js'

function baseDocument() {
  const city = createCityScene()
  city.assets.blocks = { type: '3dtiles', url: './city/tileset.json' }
  city.nodes.push({ type: '3dtiles', id: 'blocks', name: 'Blocks', visible: true, asset: 'blocks', transform: createTransform() })
  return migrateSceneDocument(city)
}

describe('map content projection details', () => {
  it('maps single-symbol fill to #RRGGBB and reapplies visibility from the document', () => {
    expect(colorFromLayerStyle({
      mode: 'single',
      symbol: { type: 'circle', radius: 4, fill: { r: 10, g: 20, b: 30, a: 1 } }
    })).toBe('#0a141e')

    const input = baseDocument()
    input.resources.points = {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { v: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } }] }
    }
    input.nodes.push({
      type: 'vector', id: 'points', name: 'Points', resource: 'points', visible: true,
      style: { mode: 'single', symbol: { type: 'circle', radius: 4, fill: { r: 10, g: 20, b: 30, a: 1 } } }
    })
    const shown = projectCesiumDocument(input)
    expect(shown.scene.nodes.find(node => node.id === 'points')).toMatchObject({ visible: true, color: '#0a141e' })

    const hidden = structuredClone(input)
    const vector = hidden.nodes.find(node => node.id === 'points')
    if (!vector || vector.type !== 'vector') throw new Error('expected vector')
    vector.visible = false
    vector.style = { mode: 'single', symbol: { type: 'circle', radius: 4, fill: { r: 0, g: 128, b: 255, a: 1 } } }
    const next = projectCesiumDocument(hidden)
    expect(next.scene.nodes.find(node => node.id === 'points')).toMatchObject({ visible: false, color: '#0080ff' })
    expect(next.document.nodes.find(node => node.id === 'points')).toMatchObject({ visible: false })
  })

  it('filters inline GeoJSON when the vector node declares a filter', () => {
    const input = baseDocument()
    input.resources.points = {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { v: 1 }, geometry: { type: 'Point', coordinates: [0, 0] } },
          { type: 'Feature', properties: { v: 2 }, geometry: { type: 'Point', coordinates: [1, 1] } }
        ]
      }
    }
    input.nodes.push({
      type: 'vector', id: 'points', name: 'Points', resource: 'points', visible: true,
      filter: [{ field: 'v', op: 'eq', value: 2 }],
      style: { mode: 'single', symbol: { type: 'circle', radius: 3 } }
    })
    const result = projectCesiumDocument(input)
    const asset = result.scene.assets['points__points']
    expect(asset?.data).toMatchObject({ features: [{ properties: { v: 2 } }] })
  })
})
