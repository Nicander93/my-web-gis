import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { processFeatures } from './processing'
import type { GisFeature, Geometry } from './types'

function feature(id: string, geometry: Geometry): GisFeature {
  return { id, geometry, properties: { name: id, nested: { value: 1 } } }
}
const mask = feature('mask', { type: 'Polygon', coordinates: [
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
  [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]]
] })
const point = (id: string, x: number, y: number) => feature(id, { type: 'Point', coordinates: [x, y] })
const sourceIds = (rows: GisFeature[]) => rows.map(row => row.metadata?.sourceId)

describe('extract by location with JSTS topology', () => {
  it('distinguishes interiors, boundary contacts, holes and exterior points', () => {
    const rows = [point('inside', 2, 2), point('edge', 0, 2), point('hole', 5, 5), point('hole-edge', 4, 5), point('outside', 12, 2)]
    expect(sourceIds(processFeatures(rows, { tool: 'extract-location', predicate: 'intersects' }, [mask]).features)).toEqual(['inside', 'edge', 'hole-edge'])
    expect(sourceIds(processFeatures(rows, { tool: 'extract-location', predicate: 'within' }, [mask]).features)).toEqual(['inside'])
    expect(sourceIds(processFeatures(rows, { tool: 'extract-location', predicate: 'disjoint' }, [mask]).features)).toEqual(['hole', 'outside'])
  })

  it('tests complete lines instead of only vertices, including lines crossing a hole', () => {
    const rows = [
      feature('inside', { type: 'LineString', coordinates: [[1, 2], [9, 2]] }),
      feature('hole-crossing', { type: 'LineString', coordinates: [[1, 5], [9, 5]] }),
      feature('edge', { type: 'LineString', coordinates: [[0, 1], [0, 9]] }),
      feature('crossing', { type: 'LineString', coordinates: [[-1, 2], [11, 2]] })
    ]
    expect(sourceIds(processFeatures(rows, { tool: 'extract-location', predicate: 'within' }, [mask]).features)).toEqual(['inside'])
    expect(processFeatures(rows, { tool: 'extract-location', predicate: 'intersects' }, [mask]).features).toHaveLength(4)
  })

  it('requires the entire multipart geometry to be within the merged region', () => {
    const rows = [
      feature('all-inside', { type: 'MultiPoint', coordinates: [[1, 1], [9, 9]] }),
      feature('part-outside', { type: 'MultiPoint', coordinates: [[1, 1], [11, 11]] }),
      feature('line-parts', { type: 'MultiLineString', coordinates: [[[1, 1], [2, 2]], [[8, 8], [9, 9]]] })
    ]
    expect(sourceIds(processFeatures(rows, { tool: 'extract-location', predicate: 'within' }, [mask]).features)).toEqual(['all-inside', 'line-parts'])
  })

  it('rejects containment when a line leaves a concave polygon between interior vertices', () => {
    const concave = feature('concave', { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10], [0, 0]]] })
    const row = feature('across-notch', { type: 'LineString', coordinates: [[1, 8], [9, 8]] })
    expect(processFeatures([row], { tool: 'extract-location', predicate: 'within' }, [concave]).features).toHaveLength(0)
    expect(processFeatures([row], { tool: 'extract-location', predicate: 'intersects' }, [concave]).features).toHaveLength(1)
  })

  it('matches the importable point example expectations', () => {
    const load = (name: string): GisFeature[] => JSON.parse(readFileSync(new URL(`../../../examples/spatial-processing/${name}.geojson`, import.meta.url), 'utf8')).features
    const rows = load('points'), masks = load('masks')
    for (const [predicate, count] of [['intersects', 2], ['within', 1], ['disjoint', 1]] as const) {
      expect(processFeatures(rows, { tool: 'extract-location', predicate }, masks).features).toHaveLength(count)
    }
  })

  it('deduplicates matches, preserves complete geometry and deep-clones properties', () => {
    const row = feature('crossing', { type: 'LineString', coordinates: [[-1, 2], [11, 2]] })
    const output = processFeatures([row], { tool: 'extract-location', predicate: 'intersects' }, [mask, mask]).features
    expect(output).toHaveLength(1)
    expect(output[0].id).not.toBe(row.id)
    expect(output[0].geometry).toEqual(row.geometry)
    expect(output[0].geometry).not.toBe(row.geometry)
    expect(output[0].properties.nested).not.toBe(row.properties.nested)
  })

  it('allows containment across adjacent masks after merging their region', () => {
    const masks = [feature('left', { type: 'Polygon', coordinates: [[[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]] }),
      feature('right', { type: 'Polygon', coordinates: [[[5, 0], [10, 0], [10, 10], [5, 10], [5, 0]]] })]
    const rows = [feature('area', { type: 'Polygon', coordinates: [[[1, 1], [9, 1], [9, 9], [1, 9], [1, 1]]] })]
    expect(processFeatures(rows, { tool: 'extract-location', predicate: 'within' }, masks).features).toHaveLength(1)
    expect(processFeatures(rows, { tool: 'extract-location', predicate: 'within' }, [mask]).features).toHaveLength(0)
  })

  it('rejects missing masks, non-polygon masks and invalid input coordinates', () => {
    expect(() => processFeatures([point('p', 1, 1)], { tool: 'extract-location', predicate: 'within' })).toThrow('第二输入')
    expect(() => processFeatures([point('p', 1, 1)], { tool: 'extract-location', predicate: 'within' }, [point('bad-mask', 1, 1)])).toThrow('不是面')
    expect(() => processFeatures([point('bad', 1000, 0)], { tool: 'extract-location', predicate: 'within' }, [mask])).toThrow('WGS84')
  })
})
