import { describe, expect, it } from 'vitest'
import { dxfDocumentToGeoJson } from './dxf.js'

describe('DXF conversion', () => {
  it('converts points, lines and closed polylines while reporting unsupported entities', () => {
    const result = dxfDocumentToGeoJson({
      entities: [
        { type: 'POINT', handle: '1', position: { x: 116.4, y: 39.9 } },
        { type: 'LINE', vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        {
          type: 'LWPOLYLINE',
          shape: true,
          vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]
        },
        { type: 'HATCH' }
      ]
    })

    expect(result.featureCollection.features).toHaveLength(3)
    expect(result.featureCollection.features[0]?.geometry?.type).toBe('Point')
    expect(result.featureCollection.features[1]?.geometry?.type).toBe('LineString')
    expect(result.featureCollection.features[2]?.geometry?.type).toBe('Polygon')
    expect(result.warnings[0]).toMatchObject({ code: 'dxf.unsupportedEntity', count: 1 })
  })
})
