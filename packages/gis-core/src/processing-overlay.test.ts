import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { processFeatures } from './processing'
import { parseGeoJsonFeatures } from './geojson'
import type { GisFeature, PolygonGeometry } from './types'

function rectangle(id: string, west: number, south: number, east: number, north: number, properties: Record<string, unknown> = {}): GisFeature {
  return { id, properties, geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } }
}

// Planar area is sufficient to verify these small synthetic rectangles without testing Turf against itself.
function area(feature: GisFeature): number {
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates]
    : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : []
  return polygons.reduce((total, rings) => total + rings.reduce((sum, ring, index) => {
    const signed = ring.reduce((a, [x, y], i) => {
      const next = ring[(i + 1) % ring.length]
      return a + x * next[1] - next[0] * y
    }, 0) / 2
    return sum + Math.abs(signed) * (index === 0 ? 1 : -1)
  }, 0), 0)
}

describe('polygon processing using Turf', () => {
  const input = rectangle('a', 0, 0, 4, 4, { name: 'A', nested: { value: 1 } })

  it('runs the importable desktop sample with the documented result counts', () => {
    const read = (name: string) => parseGeoJsonFeatures(readFileSync(new URL(`../../../examples/spatial-processing/${name}.geojson`, import.meta.url), 'utf8')).features
    const rows = read('input'), masks = read('masks')
    expect(processFeatures(rows, { tool: 'clip' }, masks).features).toHaveLength(2)
    expect(processFeatures(rows, { tool: 'intersect' }, masks).features).toHaveLength(3)
    expect(processFeatures(rows, { tool: 'difference' }, masks).features).toHaveLength(2)
    expect(processFeatures(rows, { tool: 'dissolve' }).features).toHaveLength(1)
    expect(processFeatures(rows, { tool: 'dissolve', field: 'category' }).features[0].properties).toEqual({ category: '同组' })
  })

  it('clips to the union of overlapping masks without duplicate output', () => {
    const masks = [rectangle('b', 1, 0, 3, 4), rectangle('c', 2, 0, 4, 4)]
    const result = processFeatures([input], { tool: 'clip' }, masks)
    expect(result.overlayCount).toBe(2)
    expect(result.features).toHaveLength(1)
    expect(area(result.features[0])).toBeCloseTo(12)
    expect(result.features[0].properties).toEqual(input.properties)
    expect(result.features[0].properties.nested).not.toBe(input.properties.nested)
    expect(area(input)).toBe(16)
  })

  it('intersects by feature pair and prefixes all fields to avoid conflicts', () => {
    const masks = [rectangle('b', 2, 0, 6, 4, { name: 'B', A_name: 'original' }), rectangle('c', 3, 0, 5, 4)]
    const result = processFeatures([input], { tool: 'intersect' }, masks)
    expect(result.features).toHaveLength(2)
    expect(area(result.features[0])).toBeCloseTo(8)
    expect(area(result.features[1])).toBeCloseTo(4)
    expect(result.features[0].properties).toMatchObject({ A_name: 'A', B_name: 'B', B_A_name: 'original' })
    expect(result.features[0].metadata).toMatchObject({ sourceId: 'a', overlaySourceId: 'b' })
    expect(new Set(result.features.map(feature => feature.id)).size).toBe(2)
  })

  it('difference creates holes and drops completely covered features', () => {
    const hole = rectangle('hole', 1, 1, 3, 3)
    const result = processFeatures([input, hole], { tool: 'difference' }, [hole])
    expect(result.features).toHaveLength(1)
    expect(area(result.features[0])).toBeCloseTo(12)
    expect((result.features[0].geometry as PolygonGeometry).coordinates).toHaveLength(2)
    expect(result.features[0].properties.name).toBe('A')
  })

  it('does not create area results for disjoint or boundary-only intersections', () => {
    for (const mask of [rectangle('far', 10, 0, 11, 1), rectangle('touch', 4, 0, 5, 4)]) {
      expect(processFeatures([input], { tool: 'intersect' }, [mask]).features).toHaveLength(0)
      expect(processFeatures([input], { tool: 'clip' }, [mask]).features).toHaveLength(0)
      expect(area(processFeatures([input], { tool: 'difference' }, [mask]).features[0])).toBe(16)
    }
  })

  it('dissolves overlaps and keeps disjoint components in one result', () => {
    const result = processFeatures([input, rectangle('overlap', 2, 0, 6, 4), rectangle('far', 10, 0, 11, 1)], { tool: 'dissolve' })
    expect(result.features).toHaveLength(1)
    expect(result.features[0].geometry.type).toBe('MultiPolygon')
    expect(area(result.features[0])).toBeCloseTo(25)
    expect(result.features[0].properties).toEqual({})
  })

  it('groups by typed scalar values, merging missing and null into the null group', () => {
    const rows = [1, '1', false, null, undefined].map((value, index) => rectangle(`f${index}`, index, 0, index + 0.5, 1, value === undefined ? {} : { group: value, discard: 'x' }))
    const result = processFeatures(rows, { tool: 'dissolve', field: 'group' })
    expect(result.features).toHaveLength(4)
    expect(result.features.map(f => f.properties)).toEqual([{ group: 1 }, { group: '1' }, { group: false }, { group: null }])
    expect(area(result.features[3])).toBeCloseTo(1)
  })

  it('rejects bad grouping fields and complex values', () => {
    expect(() => processFeatures([input], { tool: 'dissolve', field: 'missing' })).toThrow('不存在')
    expect(() => processFeatures([input], { tool: 'dissolve', field: 'nested' })).toThrow('复杂值')
  })

  it('rejects non-polygons, missing masks, invalid rings and self intersections', () => {
    const point: GisFeature = { id: 'point', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
    const bowtie: GisFeature = { id: 'bad', geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]] }, properties: {} }
    expect(() => processFeatures([point], { tool: 'dissolve' })).toThrow('不是面')
    expect(() => processFeatures([input], { tool: 'clip' })).toThrow('第二输入')
    expect(() => processFeatures([input], { tool: 'clip' }, [point])).toThrow('不是面')
    expect(() => processFeatures([input, bowtie], { tool: 'dissolve' })).toThrow('自相交')
    expect(() => processFeatures([input], { tool: 'intersect' }, [bowtie])).toThrow('自相交')
    expect(area(input)).toBe(16)
  })

  it('preserves a mask hole when clipping', () => {
    const mask = rectangle('mask', 0, 0, 4, 4)
    ;(mask.geometry as PolygonGeometry).coordinates.push([[1, 1], [1, 3], [3, 3], [3, 1], [1, 1]])
    const result = processFeatures([input], { tool: 'clip' }, [mask])
    expect(area(result.features[0])).toBeCloseTo(12)
  })

  it('rejects holes outside their outer ring and overlapping contained components', () => {
    const outer = rectangle('invalid-hole', 0, 0, 4, 4)
    const outside = rectangle('outside', 5, 5, 6, 6)
    ;(outer.geometry as PolygonGeometry).coordinates.push((outside.geometry as PolygonGeometry).coordinates[0])
    expect(() => processFeatures([outer], { tool: 'dissolve' })).toThrow('孔洞')
    const contained = rectangle('inner', 1, 1, 2, 2)
    const multi: GisFeature = { id: 'invalid-multi', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [(input.geometry as PolygonGeometry).coordinates, (contained.geometry as PolygonGeometry).coordinates] } }
    expect(() => processFeatures([multi], { tool: 'dissolve' })).toThrow('部件')
  })
})
