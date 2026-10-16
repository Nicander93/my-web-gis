import { describe, expect, it } from 'vitest'
import { assertValidGeometryEdits } from './geometry-edit-validation'

const shell = [[0,0],[10,0],[10,10],[0,10],[0,0]]
describe('geometry edit preflight', () => {
  it.each([
    ['自相交', { type: 'Polygon', coordinates: [[[0,0],[4,4],[0,4],[4,0],[0,0]]] }],
    ['孔洞', { type: 'Polygon', coordinates: [shell, [[11,1],[12,1],[12,2],[11,1]]] }],
    ['自相交', { type: 'MultiPolygon', coordinates: [[shell], [[[5,5],[15,5],[15,15],[5,15],[5,5]]]] }],
    ['坐标', { type: 'Point', coordinates: [NaN, 0] }],
    ['范围', { type: 'Point', coordinates: [181, 0] }],
    ['数量不足', { type: 'LineString', coordinates: [[1,1],[1,1]] }],
    ['闭合', { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1]]] }],
    ['四个', { type: 'Polygon', coordinates: [[[0,0],[1,0],[0,0]]] }],
    ['跨日期', { type: 'LineString', coordinates: [[179,0],[-179,0]] }]
  ])('rejects %s without changing any member of the gesture', (message, geometry) => {
    const input = [{ id: 'valid', geometry: { type: 'Point', coordinates: [1, 1] } }, { id: 'bad', geometry }], before = structuredClone(input)
    expect(() => assertValidGeometryEdits(input)).toThrow(message)
    expect(input).toEqual(before)
  })
  it('accepts holes, disjoint multi-polygons, XYZ points and ordinary crossing lines without mutation', () => {
    const input = [
      { id: 'polygon', geometry: { type: 'Polygon', coordinates: [shell, [[2,2],[2,3],[3,3],[3,2],[2,2]]] } },
      { id: 'parts', geometry: { type: 'MultiPolygon', coordinates: [[shell], [[[20,0],[21,0],[21,1],[20,0]]]] } },
      { id: 'point', geometry: { type: 'Point', coordinates: [116,39,12] } },
      { id: 'line', geometry: { type: 'LineString', coordinates: [[0,0],[4,4],[0,4],[4,0]] } }
    ], before = structuredClone(input)
    expect(() => assertValidGeometryEdits(input)).not.toThrow()
    expect(input).toEqual(before)
  })
})
