import { expect, it } from 'vitest'
import { checkGeometries } from './index'

it('reports first topology errors and coordinates while retaining valid features', () => {
  const input = [
    { id: 'valid', geometry: { type: 'Point', coordinates: [1, 1, 12] } },
    { id: 'cross', geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 4], [0, 4], [4, 0], [0, 0]]] } },
    { id: 'hole', geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[5, 5], [6, 5], [6, 6], [5, 5]]] } }
  ]
  const before = structuredClone(input)
  const report = checkGeometries(input)
  expect(report).toMatchObject({ checked: 3, valid: 1, invalid: 2, unsupported: 0 })
  expect(report.issues[0]).toMatchObject({ featureId: 'cross', inputIndex: 1, code: 'self-intersection', location: [2, 2] })
  expect(report.issues[1].code).toBe('hole-outside-shell')
  expect(input).toEqual(before)
})

it('continues after invalid structures, coordinates and unclosed rings', () => {
  const geometries: unknown[] = [null, { type: 'Point', coordinates: [NaN, 0] }, { type: 'Point', coordinates: [181, 0] }, { type: 'LineString', coordinates: [[1, 1]] }, { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4]]] }, { type: 'MultiPoint', coordinates: [] }, { type: 'Point', coordinates: ['1', 2] }]
  const report = checkGeometries(geometries.map((geometry, i) => ({ id: String(i), geometry })))
  expect(report.invalid).toBe(7)
  expect(report.issues.map(issue => issue.code)).toEqual(['invalid-structure', 'invalid-coordinate', 'coordinate-range', 'too-few-points', 'ring-not-closed', 'empty-geometry', 'invalid-coordinate'])
})

it('separates unsupported types and dateline inputs from invalid geometry', () => {
  const report = checkGeometries([
    { id: 'collection', geometry: { type: 'GeometryCollection', geometries: [] } },
    { id: 'dateline', geometry: { type: 'LineString', coordinates: [[179, 0], [-179, 0]] } }
  ])
  expect(report).toMatchObject({ valid: 0, invalid: 0, unsupported: 2 })
  expect(report.issues.map(issue => issue.code)).toEqual(['unsupported-type', 'antimeridian'])
})

it('supports multipart types, empty batches and XY validation with preserved Z', () => {
  expect(checkGeometries([])).toEqual({ checked: 0, valid: 0, invalid: 0, unsupported: 0, issues: [] })
  expect(checkGeometries([
    { id: 'multi-line', geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } },
    { id: 'multi-polygon', geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0, 0], [1, 0, 1], [1, 1, 2], [0, 0, 3]]]] } }
  ]).valid).toBe(2)
})
