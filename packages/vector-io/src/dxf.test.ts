import { describe, expect, it } from 'vitest'
import { dxfDocumentToGeoJson, dxfDocumentToLayers } from './dxf.js'

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

  it('groups entities by CAD layer', () => {
    const result = dxfDocumentToLayers({
      entities: [
        { type: 'POINT', layer: 'Points', position: { x: 0, y: 0 } },
        { type: 'POINT', layer: 'Points', position: { x: 1, y: 1 } },
        { type: 'LINE', layer: 'Lines', vertices: [{ x: 0, y: 0 }, { x: 2, y: 2 }] },
        { type: 'CIRCLE', layer: 'Circles', center: { x: 5, y: 5 }, radius: 10 }
      ]
    })

    expect(result.layers).toHaveLength(3)
    expect(result.layers.map(l => l.name)).toEqual(['Circles', 'Lines', 'Points'])
    
    const pointsLayer = result.layers.find(l => l.name === 'Points')
    expect(pointsLayer?.featureCollection.features).toHaveLength(2)
    
    const linesLayer = result.layers.find(l => l.name === 'Lines')
    expect(linesLayer?.featureCollection.features).toHaveLength(1)
  })

  it('allows selecting specific layers', () => {
    const result = dxfDocumentToLayers(
      {
        entities: [
          { type: 'POINT', layer: 'Points', position: { x: 0, y: 0 } },
          { type: 'LINE', layer: 'Lines', vertices: [{ x: 0, y: 0 }, { x: 2, y: 2 }] },
          { type: 'CIRCLE', layer: 'Circles', center: { x: 5, y: 5 }, radius: 10 }
        ]
      },
      { selectedLayers: ['Points', 'Lines'] }
    )

    expect(result.layers).toHaveLength(2)
    expect(result.layers.map(l => l.name).sort()).toEqual(['Lines', 'Points'])
  })

  it('skips polylines with bulges', () => {
    const result = dxfDocumentToGeoJson({
      entities: [
        {
          type: 'LWPOLYLINE',
          vertices: [
            { x: 0, y: 0 },
            { x: 1, y: 0, bulge: 0.5 },
            { x: 1, y: 1 }
          ]
        }
      ]
    })

    expect(result.featureCollection.features).toHaveLength(0)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'dxf.unsupportedEntity' })
    )
  })

  it('skips SPLINE entities', () => {
    const result = dxfDocumentToGeoJson({
      entities: [
        {
          type: 'SPLINE',
          controlPoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }]
        }
      ]
    })

    expect(result.featureCollection.features).toHaveLength(0)
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'dxf.unsupportedEntity' })
    )
  })

  it('converts TEXT and MTEXT to point features with text attributes', () => {
    const result = dxfDocumentToGeoJson({
      entities: [
        { type: 'TEXT', position: { x: 10, y: 20 }, text: 'Label 1' },
        { type: 'MTEXT', position: { x: 30, y: 40 }, text: 'Multi\\nLine' }
      ]
    })

    expect(result.featureCollection.features).toHaveLength(2)
    expect(result.featureCollection.features[0]?.geometry?.type).toBe('Point')
    expect(result.featureCollection.features[0]?.properties?.text).toBe('Label 1')
    expect(result.featureCollection.features[1]?.properties?.text).toBe('Multi\\nLine')
  })

  it('warns about entities on each layer separately', () => {
    const result = dxfDocumentToLayers({
      entities: [
        { type: 'POINT', layer: 'Layer1', position: { x: 0, y: 0 } },
        { type: 'HATCH', layer: 'Layer1' },
        { type: 'POINT', layer: 'Layer2', position: { x: 1, y: 1 } },
        { type: 'HATCH', layer: 'Layer2' },
        { type: 'HATCH', layer: 'Layer2' }
      ]
    })

    const layer1 = result.layers.find(l => l.name === 'Layer1')
    expect(layer1?.warnings).toHaveLength(1)
    expect(layer1?.warnings[0]?.message).toContain('Layer1')
    expect(layer1?.warnings[0]?.count).toBe(1)
    
    const layer2 = result.layers.find(l => l.name === 'Layer2')
    expect(layer2?.warnings).toHaveLength(1)
    expect(layer2?.warnings[0]?.count).toBe(2)
  })
})
