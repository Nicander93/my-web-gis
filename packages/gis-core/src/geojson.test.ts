import { describe, expect, it } from 'vitest'
import { inferLayerStyleKind, parseGeoJsonFeatures, stringifyGeoJson } from './index'

describe('GeoJSON helpers', () => {
  it('parses and exports feature collections', () => {
    const features = parseGeoJsonFeatures({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'road-1',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
          properties: { name: 'Road 1' }
        }
      ]
    })

    expect(features[0]?.id).toBe('road-1')
    expect(inferLayerStyleKind(features)).toBe('line')
    expect(JSON.parse(stringifyGeoJson(features)).features[0].properties.name).toBe('Road 1')
  })
})
