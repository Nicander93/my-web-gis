import { describe, expect, it } from 'vitest'
import { processFeatures } from './processing'
import type { GisFeature, PolygonGeometry } from './types'

const point: GisFeature = { id: 'p', geometry: { type: 'Point', coordinates: [116.4, 39.9] }, properties: { name: '站点', nested: { count: 2 } } }
const polygon: GisFeature & { geometry: PolygonGeometry } = { id: 'area', geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] }, properties: { name: '范围' } }

describe('spatial processing', () => {
  it('buffers in explicit units and preserves independent properties', () => {
    const result = processFeatures([point], { tool: 'buffer', distance: 1000, unit: 'meters' })
    const km = processFeatures([point], { tool: 'buffer', distance: 1, unit: 'kilometers' })
    expect(result.features[0].geometry).toEqual(km.features[0].geometry)
    expect(result.features[0].geometry.type).toBe('Polygon')
    const ring = (result.features[0].geometry as PolygonGeometry).coordinates[0]
    const north = Math.max(...ring.map(p => p[1]))
    expect((north - 39.9) * 111195).toBeCloseTo(1000, 0)
    expect(result.features[0].id).not.toBe(point.id)
    result.features[0].properties.name = '新名称'
    expect(point.properties.name).toBe('站点')
    expect(result.features[0].metadata?.sourceId).toBe('p')
  })
  it('vertex centroid excludes the duplicated closing coordinate', () => {
    expect(processFeatures([polygon], { tool: 'centroid' }).features[0].geometry).toEqual({ type: 'Point', coordinates: [1, 1] })
  })
  it('envelopes the entire scope and rejects degenerate ranges', () => {
    const result = processFeatures([polygon, point], { tool: 'envelope' })
    expect(result.features).toHaveLength(1)
    expect(result.features[0].properties.input_count).toBe(2)
    expect(result.features[0].geometry).toEqual({ type: 'Polygon', coordinates: [[[0, 0], [116.4, 0], [116.4, 39.9], [0, 39.9], [0, 0]]] })
    expect(() => processFeatures([point], { tool: 'envelope' })).toThrow('退化')
  })
  it('splits multi geometries with distinct ids and retains polygon holes', () => {
    const withHole = [...polygon.geometry.coordinates, [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 0.5]] as PolygonGeometry['coordinates'][number]]
    const input: GisFeature = { ...polygon, geometry: { type: 'MultiPolygon', coordinates: [withHole, [[[3, 3], [4, 3], [4, 4], [3, 3]]]] } }
    const result = processFeatures([input], { tool: 'explode' }).features
    expect(result).toHaveLength(2)
    expect(new Set(result.map(f => f.id)).size).toBe(2)
    expect(result[0].geometry).toEqual({ type: 'Polygon', coordinates: withHole })
    expect(result[1].geometry.type).toBe('Polygon')
    result[0].properties.name = '更改'
    expect(result[1].properties.name).toBe('范围')
    expect(input.properties.name).toBe('范围')
  })
  it('rejects bad distances, invalid coordinates and unsupported geography', () => {
    for (const distance of [0, -1, NaN, Infinity, 1000001]) expect(() => processFeatures([point], { tool: 'buffer', distance, unit: 'meters' })).toThrow('距离')
    expect(() => processFeatures([], { tool: 'centroid' })).toThrow('没有要素')
    expect(() => processFeatures([{ ...point, geometry: { type: 'Point', coordinates: [11600000, 4000000] } }], { tool: 'centroid' })).toThrow('WGS84')
    expect(() => processFeatures([{ ...point, geometry: { type: 'Point', coordinates: [0, 89] } }], { tool: 'buffer', distance: 100, unit: 'meters' })).toThrow('极区')
    expect(() => processFeatures([{ ...polygon, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } }], { tool: 'buffer', distance: 100, unit: 'meters' })).toThrow('未闭合')
  })
})
