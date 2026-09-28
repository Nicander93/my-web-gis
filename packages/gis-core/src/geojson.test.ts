import { describe, expect, it } from 'vitest'
import { inferLayerStyleKind, parseGeoJsonFeatures, stringifyGeoJson } from './index'

describe('GeoJSON helpers', () => {
  it('parses and exports feature collections', () => {
    const result = parseGeoJsonFeatures({
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

    expect(result.features[0]?.id).toBe('road-1')
    expect(result.warnings).toHaveLength(0)
    expect(inferLayerStyleKind(result.features)).toBe('line')
    expect(JSON.parse(stringifyGeoJson(result.features)).features[0].properties.name).toBe('Road 1')
  })
  
  it('handles empty geometry', () => {
    const result = parseGeoJsonFeatures({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: null, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
      ]
    })
    
    expect(result.features).toHaveLength(1)
    expect(result.warnings.find(w => w.code === 'geojson.emptyGeometry')).toBeDefined()
  })
  
  it('rejects GeometryCollection', () => {
    const result = parseGeoJsonFeatures({
      type: 'FeatureCollection',
      features: [
        { 
          type: 'Feature', 
          geometry: { 
            type: 'GeometryCollection', 
            geometries: [{ type: 'Point', coordinates: [0, 0] }] 
          }, 
          properties: {} 
        }
      ]
    })
    
    expect(result.features).toHaveLength(0)
    expect(result.warnings.find(w => w.code === 'geojson.unsupportedGeometry')).toBeDefined()
  })
  
  it('validates coordinates', () => {
    const result = parseGeoJsonFeatures({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [NaN, 0] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [Infinity, 0] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
      ]
    })
    
    expect(result.features).toHaveLength(1)
    expect(result.warnings.find(w => w.code === 'geojson.invalidCoordinates')?.count).toBe(2)
  })
  
  it('generates stable IDs for duplicates', () => {
    const result = parseGeoJsonFeatures({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 'dup', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
        { type: 'Feature', id: 'dup', geometry: { type: 'Point', coordinates: [1, 1] }, properties: {} }
      ]
    }, { importId: 'test-import' })
    
    expect(result.features).toHaveLength(2)
    expect(result.features[0]?.id).toBe('dup')
    expect(result.features[1]?.id).toBe('test-import-1')
    expect(result.warnings.find(w => w.code === 'geojson.duplicateId')).toBeDefined()
  })
  
  it('preserves source ID in metadata', () => {
    const result = parseGeoJsonFeatures({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', id: 123, geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
      ]
    }, { sourceCrs: 'EPSG:3857' })
    
    expect(result.features[0]?.id).toBe('123')
    expect(result.features[0]?.metadata?.sourceId).toBe(123)
    expect(result.features[0]?.metadata?.sourceCrs).toBe('EPSG:3857')
  })
  
  it('applies coordinate transformation', () => {
    const transform = ([x, y]: number[]) => [x * 2, y * 2]
    
    const result = parseGeoJsonFeatures({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [100, 200] }, properties: {} }
      ]
    }, { transform })
    
    expect(result.features[0]?.geometry.coordinates).toEqual([200, 400])
  })
})
