import { describe, expect, it } from 'vitest'
import type { LineString, Polygon, MultiPolygon } from 'geojson'
import { mergePolygonGeometries, splitPolygonGeometry } from './topology-edits.js'
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import { checkGeometries } from './geometry-check.js'

const square = (x: number, y: number, size = 10): Polygon => ({ type: 'Polygon', coordinates: [
  [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]] ] })
const line = (coordinates: number[][]): LineString => ({ type: 'LineString', coordinates })
const area = (geometry: Polygon | MultiPolygon) => new GeoJSONReader().read(geometry).getArea()

describe('real polygon topology edits', () => {
  it('unions overlaps and touching edges without double counting and retains disjoint parts', () => {
    expect(area(mergePolygonGeometries([square(0, 0), square(5, 0)]))).toBe(150)
    expect(mergePolygonGeometries([square(0, 0), square(10, 0)]).type).toBe('Polygon')
    expect(mergePolygonGeometries([square(0, 0), square(20, 0)]).type).toBe('MultiPolygon')
  })
  it('retains a hole when merging an adjoining polygon', () => {
    const donut = square(0, 0)
    donut.coordinates.push([[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]])
    const result = mergePolygonGeometries([donut, square(10, 0)])
    expect(area(result)).toBe(164)
    expect(result.type === 'Polygon' && result.coordinates.length).toBe(2)
  })
  it('splits across a hole with no missing buffer strip or filled hole', () => {
    const donut = square(0, 0)
    donut.coordinates.push([[2, 2], [2, 8], [8, 8], [8, 2], [2, 2]])
    const result = splitPolygonGeometry(donut, line([[5, -1], [5, 11]]))!
    expect(result).toHaveLength(2)
    expect(result.reduce((sum, part) => sum + area(part), 0)).toBe(64)
    expect(checkGeometries(result.map((geometry, index) => ({ id: String(index), geometry }))).invalid).toBe(0)
  })
  it('supports a bent cutter and multiple cut segments', () => {
    const bent = splitPolygonGeometry(square(0, 0), line([[-1, 3], [5, 3], [5, 11]]))!
    expect(bent).toHaveLength(2)
    expect(bent.reduce((sum, part) => sum + area(part), 0)).toBe(100)
    const grid = splitPolygonGeometry(square(0, 0), { type: 'MultiLineString', coordinates: [
      [[-1, 5], [11, 5]], [[5, -1], [5, 11]] ] })!
    expect(grid).toHaveLength(4)
    expect(grid.reduce((sum, part) => sum + area(part), 0)).toBe(100)
  })
  it('does not split for a miss, a tangent or a dangling line ending inside the polygon', () => {
    for (const cutter of [line([[-1, -1], [-1, 11]]), line([[0, -1], [0, 11]]), line([[-1, 5], [5, 5]])]) {
      expect(splitPolygonGeometry(square(0, 0), cutter)).toBeNull()
    }
  })
  it('can split an interior closed loop while preserving the hole in its surrounding face', () => {
    const result = splitPolygonGeometry(square(0, 0), line([[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]]))!
    expect(result).toHaveLength(2)
    expect(result.reduce((sum, part) => sum + area(part), 0)).toBe(100)
  })
  it('handles a multipart input without falsely splitting on an unrelated cutter', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [square(0, 0).coordinates, square(20, 0).coordinates] }
    expect(splitPolygonGeometry(multi, line([[15, -1], [15, 11]]))).toBeNull()
    const result = splitPolygonGeometry(multi, line([[5, -1], [5, 11]]))!
    expect(result).toHaveLength(3)
    expect(result.reduce((sum, part) => sum + area(part), 0)).toBe(200)
  })
  it('rejects invalid and higher-dimensional input without mutating it', () => {
    const invalid: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]]] }
    expect(() => mergePolygonGeometries([invalid, square(20, 0)])).toThrow(/自相交/)
    const threeD = square(0, 0)
    threeD.coordinates[0] = threeD.coordinates[0].map((position) => [...position, 7])
    const before = structuredClone(threeD)
    expect(() => splitPolygonGeometry(threeD, line([[5, -1], [5, 11]]))).toThrow(/高程/)
    expect(threeD).toEqual(before)
  })
})
