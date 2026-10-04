import { expect, it } from 'vitest'
import { clipLines, type AnalysisFeature } from './index'

const line = (id: string, coordinates: number[][]): AnalysisFeature => ({ id, geometry: { type: 'LineString', coordinates }, properties: { road: 'A', nested: { value: 1 } } })
const mask = (west = 0, east = 10): AnalysisFeature => ({ id: 'mask', geometry: { type: 'Polygon', coordinates: [[[west, 0], [east, 0], [east, 10], [west, 10], [west, 0]]] }, properties: { ignored: true } })
const parts = (feature: AnalysisFeature): number[][][] => feature.geometry.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : []
const length = (feature: AnalysisFeature) => parts(feature).reduce((sum, part) => sum + part.slice(1).reduce((value, p, i) => value + Math.hypot(p[0] - part[i][0], p[1] - part[i][1]), 0), 0)

it('clips crossing lines and isolates attributes, ids and source metadata', () => {
  const source = line('road', [[-2, 5, 7], [12, 5, 9]])
  const before = structuredClone(source)
  const result = clipLines([source], [mask()])[0]
  expect(length(result)).toBeCloseTo(10)
  expect(result.properties).toEqual(source.properties)
  expect(result.metadata?.sourceId).toBe('road')
  expect(result.id).not.toBe(source.id)
  expect(parts(result).flat().every(point => point.length === 2)).toBe(true)
  ;(result.properties.nested as { value: number }).value = 2
  expect(source).toEqual(before)
})

it('retains boundary segments but discards disjoint lines and point-only tangencies', () => {
  const result = clipLines([line('boundary', [[-2, 0], [12, 0]]), line('touch', [[-2, -2], [0, 0]]), line('outside', [[-2, -2], [-1, -1]])], [mask()])
  expect(result).toHaveLength(1)
  expect(result[0].metadata?.sourceId).toBe('boundary')
  expect(length(result[0])).toBeCloseTo(10)
})

it('removes hole interiors and retains disjoint portions in one multipart result', () => {
  const area = mask()
  if (area.geometry.type !== 'Polygon') throw new Error('fixture')
  area.geometry.coordinates.push([[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]])
  const result = clipLines([line('road', [[-2, 5], [12, 5]])], [area])
  expect(result).toHaveLength(1)
  expect(result[0].geometry.type).toBe('MultiLineString')
  expect(parts(result[0])).toHaveLength(2)
  expect(length(result[0])).toBeCloseTo(8)
})

it('unions overlapping masks and handles multiline input without duplicate coverage', () => {
  const source: AnalysisFeature = { ...line('multi', []), geometry: { type: 'MultiLineString', coordinates: [[[-2, 2], [12, 2]], [[-2, 8], [12, 8]]] } }
  const result = clipLines([source], [mask(0, 6), mask(4, 10)])
  expect(result).toHaveLength(1)
  expect(length(result[0])).toBeCloseTo(20)
  expect(parts(result[0])).toHaveLength(2)
  expect(clipLines([], [mask()])).toEqual([])
  expect(clipLines([source], [])).toEqual([])
})

it('rejects wrong types, invalid masks, malformed lines and unsupported coordinate ranges', () => {
  expect(() => clipLines([mask()], [mask()])).toThrow('不是线')
  expect(() => clipLines([line('road', [[0, 0], [1, 1]])], [line('mask', [[0, 0], [1, 1]])])).toThrow('不是面')
  expect(() => clipLines([line('bad', [[0, 0]])], [mask()])).toThrow('两个坐标')
  expect(() => clipLines([line('bad', [[179, 0], [-179, 1]])], [mask()])).toThrow('日期变更线')
  const invalid = mask()
  invalid.geometry = { type: 'Polygon', coordinates: [[[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]]] }
  expect(() => clipLines([line('road', [[0, 0], [1, 1]])], [invalid])).toThrow('自相交')
})

it('supports disconnected multipolygon masks and ignores point members in mixed intersections', () => {
  const left = mask(0, 2), right = mask(8, 10)
  if (left.geometry.type !== 'Polygon' || right.geometry.type !== 'Polygon') throw new Error('fixture')
  const area: AnalysisFeature = { ...left, geometry: { type: 'MultiPolygon', coordinates: [left.geometry.coordinates, right.geometry.coordinates] } }
  const clipped = clipLines([line('road', [[-1, 5], [11, 5]])], [area])[0]
  expect(parts(clipped)).toHaveLength(2)
  expect(length(clipped)).toBeCloseTo(4)
  const mixed: AnalysisFeature = { ...line('mixed', []), geometry: { type: 'MultiLineString', coordinates: [[[1, 5], [3, 5]], [[-2, -2], [0, 0]]] } }
  const result = clipLines([mixed], [mask()])
  expect(result).toHaveLength(1)
  expect(result[0].geometry.type).toBe('LineString')
  expect(length(result[0])).toBeCloseTo(2)
})
