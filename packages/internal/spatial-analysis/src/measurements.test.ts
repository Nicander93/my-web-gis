import { expect, it } from 'vitest'
import { measureGeometry, addGeometryMeasurements, type AnalysisFeature, type AnalysisGeometry } from './index'

const square: AnalysisGeometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
const line: AnalysisGeometry = { type: 'LineString', coordinates: [[0, 0, 9], [1, 0, 999]] }

it('matches an equatorial reference distance and converts units without including Z', () => {
  const meters = measureGeometry(line, { measurement: 'length', unit: 'meters' })
  expect(meters).toBeCloseTo(111195.080233533, 6)
  expect(measureGeometry(line, { measurement: 'length', unit: 'kilometers' })).toBeCloseTo(meters / 1000, 10)
  expect(measureGeometry({ type: 'MultiLineString', coordinates: [line.coordinates, line.coordinates] }, { measurement: 'length', unit: 'meters' })).toBeCloseTo(meters * 2, 6)
})

it('calculates spherical rectangle area, subtracts holes and sums disjoint polygons', () => {
  const expected = 6371008.8 ** 2 * (Math.PI / 180) * Math.sin(Math.PI / 180)
  const area = measureGeometry(square, { measurement: 'area', unit: 'square-meters' })
  expect(area).toBeCloseTo(expected, 3)
  expect(measureGeometry(square, { measurement: 'area', unit: 'hectares' })).toBeCloseTo(area / 10000, 8)
  expect(measureGeometry(square, { measurement: 'area', unit: 'square-kilometers' })).toBeCloseTo(area / 1000000, 8)
  const hole: AnalysisGeometry = { type: 'Polygon', coordinates: [[[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]] }
  const holed: AnalysisGeometry = { type: 'Polygon', coordinates: [square.coordinates[0], hole.coordinates[0]] }
  expect(measureGeometry(holed, { measurement: 'area', unit: 'square-meters' })).toBeCloseTo(area - measureGeometry(hole, { measurement: 'area', unit: 'square-meters' }), 3)
  const multi: AnalysisGeometry = { type: 'MultiPolygon', coordinates: [square.coordinates, square.coordinates.map(ring => ring.map(([x, y]) => [x + 2, y]))] }
  expect(measureGeometry(multi, { measurement: 'area', unit: 'square-meters' })).toBeCloseTo(area * 2, 3)
  expect(measureGeometry({ ...square, coordinates: square.coordinates.map(ring => [...ring].reverse()) }, { measurement: 'area', unit: 'square-meters' })).toBeCloseTo(area, 3)
})

it('includes both external and hole boundaries in perimeter', () => {
  const hole = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]]
  const holed: AnalysisGeometry = { type: 'Polygon', coordinates: [square.coordinates[0], hole] }
  const outer = measureGeometry(square, { measurement: 'perimeter', unit: 'meters' })
  expect(measureGeometry(holed, { measurement: 'perimeter', unit: 'meters' })).toBeCloseTo(outer + measureGeometry({ type: 'LineString', coordinates: hole }, { measurement: 'length', unit: 'meters' }), 5)
})

it('creates independent fields, rejects collisions and preserves the original geometry', () => {
  const source: AnalysisFeature = { id: 'road', geometry: line, properties: { nested: { value: 1 } } }
  const before = structuredClone(source)
  const result = addGeometryMeasurements([source], { measurement: 'length', unit: 'meters', field: 'length_m' })[0]
  expect(result.metadata?.sourceId).toBe('road')
  expect(result.id).not.toBe(source.id)
  expect(result.geometry).toEqual(source.geometry)
  ;(result.properties.nested as { value: number }).value = 2
  expect(source).toEqual(before)
  expect(() => addGeometryMeasurements([result], { measurement: 'length', unit: 'meters', field: 'length_m' })).toThrow('已存在')
  expect(() => addGeometryMeasurements([source], { measurement: 'length', unit: 'meters', field: '__proto__' })).toThrow('保留')
})

it('rejects wrong geometry types, malformed geometry and unsupported dateline inputs', () => {
  expect(() => measureGeometry(line, { measurement: 'area', unit: 'hectares' })).toThrow('仅支持面')
  expect(() => measureGeometry(square, { measurement: 'length', unit: 'meters' })).toThrow('仅支持线')
  expect(() => measureGeometry({ type: 'LineString', coordinates: [[179, 0], [-179, 0]] }, { measurement: 'length', unit: 'meters' })).toThrow('日期变更线')
  expect(() => measureGeometry({ type: 'LineString', coordinates: [[1000, 0], [1001, 0]] }, { measurement: 'length', unit: 'meters' })).toThrow('WGS84')
})
