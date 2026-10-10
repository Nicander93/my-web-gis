import { describe, expect, it } from 'vitest'
import Point from 'ol/geom/Point.js'
import LineString from 'ol/geom/LineString.js'
import Polygon, { fromExtent } from 'ol/geom/Polygon.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import MultiLineString from 'ol/geom/MultiLineString.js'
import GeometryCollection from 'ol/geom/GeometryCollection.js'
import Circle from 'ol/geom/Circle.js'
import { applySelection, selectionOperation } from './selection.js'
import { getBoxCandidates, intersectsSelectionBox } from './hit-test.js'

describe('selection identity and operations', () => {
  const a = { layerKey: 'a', featureId: 1 }
  const b = { layerKey: 'a', featureId: '1' }
  const c = { layerKey: 'b', featureId: 1 }
  it('retains numeric/string and layer identity independently', () => {
    expect(applySelection([a], [b, c, a], 'add')).toEqual([a, b, c])
    expect(applySelection([a, b, c], [b], 'remove')).toEqual([a, c])
    expect(applySelection([a], [], 'replace')).toEqual([])
    expect(applySelection([a], [], 'add')).toEqual([a])
  })
  it('gives remove priority over shift and does not mutate inputs', () => {
    expect(selectionOperation({ altKey: true, shiftKey: true })).toBe('remove')
    const values = Object.freeze([Object.freeze(a)])
    expect(applySelection(values, [c], 'replace')).toEqual([c])
    expect(values).toEqual([a])
  })
})

describe('box geometry', () => {
  it('intersects the common clipped area, not two independently intersecting extents', () => {
    const box = fromExtent([-1, -1, 1, 1]); box.rotate(Math.PI / 4, [0, 0])
    const clip = [0.9, -2, 2, 2]
    expect(intersectsSelectionBox(new LineString([[0.6, 0.7], [1.2, 0.7]]), box, undefined, clip)).toBe(false)
    expect(intersectsSelectionBox(new Point([1, 0]), box, undefined, clip)).toBe(true)
    expect(intersectsSelectionBox(new Point([0, 0]), box, undefined, clip)).toBe(false)
    expect(intersectsSelectionBox(new Point([1, 1]), box, undefined, clip)).toBe(false)
  })
  it('keeps multipart paths separate and supports collections and circles', () => {
    const box = fromExtent([-2, -2, 2, 2]), clip = [-0.5, -0.5, 0.5, 0.5]
    const parts = new MultiLineString([[[-2, 0], [-1, 0]], [[1, 0], [2, 0]]])
    expect(intersectsSelectionBox(parts, box, undefined, clip)).toBe(false)
    expect(intersectsSelectionBox(new GeometryCollection([parts, new Point([0, 0])]), box, undefined, clip)).toBe(true)
    expect(intersectsSelectionBox(new Circle([1, 0], 0.6), box, undefined, clip)).toBe(true)
    expect(intersectsSelectionBox(new Circle([1, 1], 0.1), box, undefined, clip)).toBe(false)
  })
  it('preserves clipped holes, boundary contacts, empty geometries and global world clipping', () => {
    const polygon = new Polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]]])
    expect(intersectsSelectionBox(polygon, fromExtent([0, 0, 10, 10]), undefined, [4, 4, 6, 6])).toBe(false)
    expect(intersectsSelectionBox(polygon, fromExtent([0, 0, 10, 10]), undefined, [3, 4, 3, 6])).toBe(true)
    expect(intersectsSelectionBox(new LineString([]), fromExtent([0, 0, 1, 1]))).toBe(false)
    expect(intersectsSelectionBox(new Point([-179, 0]), fromExtent([180, -1, 182, 1]), 360, [180, -1, 180.5, 1])).toBe(false)
    expect(intersectsSelectionBox(new Point([-179, 0]), fromExtent([180, -1, 182, 1]), 360, [180, -1, 182, 1])).toBe(true)
  })
  it('queries indexed candidates across worlds without a full-feature scan', () => {
    const near = new Feature(new Point([-179, 0]))
    const far = new Feature(new Point([0, 50]))
    const source = new VectorSource({ features: [near, far] })
    source.getFeatures = () => { throw new Error('Full source scan is forbidden') }
    expect(getBoxCandidates(source, fromExtent([180, -1, 182, 1]), 360)).toEqual([near])
    expect(getBoxCandidates(source, fromExtent([-1, -1, 1, 1]), 360)).toEqual([])
  })
  it('rejects bbox-only line hits', () => {
    const line = new LineString([[0, 0], [10, 10]])
    expect(intersectsSelectionBox(line, fromExtent([0, 8, 2, 10]))).toBe(false)
    expect(intersectsSelectionBox(line, fromExtent([4, 4, 6, 6]))).toBe(true)
  })
  it('honors polygon holes and boundary contact', () => {
    const polygon = new Polygon([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]]])
    expect(intersectsSelectionBox(polygon, fromExtent([4, 4, 6, 6]))).toBe(false)
    expect(intersectsSelectionBox(polygon, fromExtent([2, 4, 3, 6]))).toBe(true)
  })
  it('aligns rotated boxes and wrapped worlds without mutating geometry', () => {
    const box = fromExtent([-1, -1, 1, 1]); box.rotate(Math.PI / 4, [0, 0])
    const point = new Point([1.3, 1.3])
    expect(intersectsSelectionBox(point, box)).toBe(false)
    expect(intersectsSelectionBox(new Point([0, 0]), box)).toBe(true)
    const wrapped = new Point([-179, 0])
    expect(intersectsSelectionBox(wrapped, fromExtent([180, -1, 182, 1]), 360)).toBe(true)
    expect(wrapped.getCoordinates()).toEqual([-179, 0])
  })
})
