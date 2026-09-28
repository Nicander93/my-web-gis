import { describe, expect, it } from 'vitest'
import { createCoordinateTransform, transformGeometry } from './coordinate-transform'

describe('Coordinate transformation', () => {
  it('transforms EPSG:3857 to EPSG:4326 within acceptable tolerance', () => {
    const result = createCoordinateTransform({ code: 'EPSG:3857' }, 'EPSG:4326')
    
    expect(result.success).toBe(true)
    expect(result.transform).toBeDefined()
    
    if (result.transform) {
      const [lon, lat] = result.transform([12958224.1, 4865942.3])
      
      expect(lon).toBeCloseTo(116.4, 0)
      expect(lat).toBeCloseTo(40.0, 0)
    }
  })
  
  it('does not transform when source and target CRS are the same', () => {
    const result = createCoordinateTransform({ code: 'EPSG:4326' }, 'EPSG:4326')
    
    expect(result.success).toBe(true)
    expect(result.transform).toBeDefined()
    
    if (result.transform) {
      const coords = result.transform([116.4, 39.9])
      expect(coords).toEqual([116.4, 39.9])
    }
  })
  
  it('preserves Z coordinate during transformation', () => {
    const result = createCoordinateTransform({ code: 'EPSG:3857' }, 'EPSG:4326')
    
    if (result.transform) {
      const [lon, lat, z] = result.transform([12958224.1, 4865942.3, 100])
      
      expect(lon).toBeCloseTo(116.4, 0)
      expect(lat).toBeCloseTo(40.0, 0)
      expect(z).toBe(100)
    }
  })
  
  it('transforms Point geometry', () => {
    const result = createCoordinateTransform({ code: 'EPSG:3857' }, 'EPSG:4326')
    
    if (result.transform) {
      const geometry = {
        type: 'Point' as const,
        coordinates: [12958224.1, 4865942.3]
      }
      
      const transformed = transformGeometry(geometry, result.transform)
      
      expect(transformed.coordinates[0]).toBeCloseTo(116.4, 0)
      expect(transformed.coordinates[1]).toBeCloseTo(40.0, 0)
    }
  })
  
  it('transforms LineString geometry', () => {
    const result = createCoordinateTransform({ code: 'EPSG:3857' }, 'EPSG:4326')
    
    if (result.transform) {
      const geometry = {
        type: 'LineString' as const,
        coordinates: [
          [12958224.1, 4865942.3],
          [12970000, 4880000]
        ]
      }
      
      const transformed = transformGeometry(geometry, result.transform)
      
      expect(transformed.coordinates[0][0]).toBeCloseTo(116.4, 0)
      expect(transformed.coordinates[0][1]).toBeCloseTo(40.0, 0)
    }
  })
  
  it('transforms Polygon geometry', () => {
    const result = createCoordinateTransform({ code: 'EPSG:3857' }, 'EPSG:4326')
    
    if (result.transform) {
      const geometry = {
        type: 'Polygon' as const,
        coordinates: [[
          [12958224.1, 4865942.3],
          [12970000, 4865942.3],
          [12970000, 4880000],
          [12958224.1, 4880000],
          [12958224.1, 4865942.3]
        ]]
      }
      
      const transformed = transformGeometry(geometry, result.transform)
      
      expect(transformed.coordinates[0][0][0]).toBeCloseTo(116.4, 0)
      expect(transformed.coordinates[0][0][1]).toBeCloseTo(40.0, 0)
    }
  })
  
  it('returns error for undefined source CRS', () => {
    const result = createCoordinateTransform(undefined, 'EPSG:4326')
    
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
  
  it('returns error for CRS without code', () => {
    const result = createCoordinateTransform({}, 'EPSG:4326')
    
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})
