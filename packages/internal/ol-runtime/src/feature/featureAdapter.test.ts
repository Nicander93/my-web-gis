import { describe, expect, it } from 'vitest'
import { fromOlFeature, toOlFeature } from './featureAdapter'

describe('feature adapter', () => {
  it('uses the selected projection for editing round trips', () => {
    const feature = { id: 'geographic', geometry: { type: 'Point' as const, coordinates: [106, 26] as [number, number] }, properties: { value: 1 } }
    const native = toOlFeature(feature, 'EPSG:4326')
    expect(native.getGeometry()?.getExtent()).toEqual([106, 26, 106, 26])
    expect(fromOlFeature(native, 'EPSG:4326')).toEqual(feature)
  })
  it('preserves domain feature id and properties across OL conversion', () => {
    const feature = {
      id: 'station-1',
      geometry: {
        type: 'Point' as const,
        coordinates: [106.66, 26.57] as [number, number]
      },
      properties: {
        name: 'Gauge A',
        status: 'active'
      }
    }

    const olFeature = toOlFeature(feature)
    const restored = fromOlFeature(olFeature)

    expect(olFeature.getId()).toBe('station-1')
    expect(olFeature.get('domainFeatureId')).toBe('station-1')
    expect(restored.id).toBe('station-1')
    expect(restored.geometry.type).toBe('Point')
    expect(restored.properties).toEqual(feature.properties)
  })
})
