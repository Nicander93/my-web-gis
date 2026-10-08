import type Geometry from 'ol/geom/Geometry.js'
import type Polygon from 'ol/geom/Polygon.js'
import type VectorSource from 'ol/source/Vector.js'
import type { FeatureLike } from 'ol/Feature.js'
import type { Coordinate } from 'ol/coordinate.js'
import type { Extent } from 'ol/extent.js'
import GeometryCollection from 'ol/geom/GeometryCollection.js'
import Circle from 'ol/geom/Circle.js'
import Point from 'ol/geom/Point.js'
import MultiPoint from 'ol/geom/MultiPoint.js'
import LineString from 'ol/geom/LineString.js'
import LinearRing from 'ol/geom/LinearRing.js'
import MultiLineString from 'ol/geom/MultiLineString.js'
import PolygonGeometry from 'ol/geom/Polygon.js'
import MultiPolygon from 'ol/geom/MultiPolygon.js'

/** Clip the actual quadrilateral, rather than intersecting its bounding box. */
function clipRing(ring: Coordinate[], extent: Extent): Coordinate[] {
  let result = ring.slice(0, -1)
  for (const [axis, bound, direction] of [[0, extent[0], 1], [0, extent[2], -1], [1, extent[1], 1], [1, extent[3], -1]]) {
    const input = result; result = []
    for (let i = 0; i < input.length; i++) {
      const a = input[i], b = input[(i + 1) % input.length]
      const insideA = (a[axis] - bound) * direction >= 0
      const insideB = (b[axis] - bound) * direction >= 0
      if (insideA) result.push(a)
      if (insideA !== insideB) {
        const t = (bound - a[axis]) / (b[axis] - a[axis])
        result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
      }
    }
  }
  return result
}

function cross(a: Coordinate, b: Coordinate, c: Coordinate): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function onSegment(p: Coordinate, a: Coordinate, b: Coordinate): boolean {
  return cross(a, b, p) === 0 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])
}

function segmentsIntersect(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  return onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)
    || cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
}

function contains(ring: Coordinate[], p: Coordinate): boolean {
  let positive = false, negative = false, area = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    if (onSegment(p, a, b)) return true
    const value = cross(a, b, p)
    positive ||= value > 0; negative ||= value < 0
    area += cross(ring[0], a, b)
  }
  return area !== 0 && !(positive && negative)
}

function intersectsClippedRing(geometry: Geometry, ring: Coordinate[]): boolean {
  if (geometry instanceof GeometryCollection) return geometry.getGeometriesArray().some(child => intersectsClippedRing(child, ring))
  if (ring.some(point => geometry.intersectsCoordinate(point))) return true
  if (geometry instanceof Circle) {
    const center = geometry.getCenter(), radius = geometry.getRadius()
    if (contains(ring, center)) return true
    return ring.some((a, i) => {
      const b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1]
      const length = dx * dx + dy * dy
      const t = length ? Math.max(0, Math.min(1, ((center[0] - a[0]) * dx + (center[1] - a[1]) * dy) / length)) : 0
      return Math.hypot(center[0] - a[0] - t * dx, center[1] - a[1] - t * dy) <= radius
    })
  }
  let paths: Coordinate[][] = []
  if (geometry instanceof Point) paths = [[geometry.getCoordinates()]]
  else if (geometry instanceof MultiPoint) paths = geometry.getCoordinates().map(point => [point])
  else if (geometry instanceof LineString || geometry instanceof LinearRing) paths = [geometry.getCoordinates()]
  else if (geometry instanceof MultiLineString || geometry instanceof PolygonGeometry) paths = geometry.getCoordinates()
  else if (geometry instanceof MultiPolygon) paths = geometry.getCoordinates().flat()
  return paths.some(path => path.some(point => Number.isFinite(point[0]) && Number.isFinite(point[1]) && contains(ring, point))
    || path.some((point, i) => i > 0 && ring.some((a, j) => segmentsIntersect(path[i - 1], point, a, ring[(j + 1) % ring.length]))))
}

/** Query the source index in each intersected world rather than scanning every loaded feature. */
export function getBoxCandidates(source: VectorSource<FeatureLike>, box: Polygon, worldWidth?: number): FeatureLike[] {
  const extent = box.getExtent()
  if (!worldWidth) return source.getFeaturesInExtent(extent)
  const loaded = source.getExtent()
  if (!loaded || !loaded.every(Number.isFinite)) return []
  const first = Math.ceil((extent[0] - loaded[2]) / worldWidth)
  const last = Math.floor((extent[2] - loaded[0]) / worldWidth)
  const result = new Set<FeatureLike>()
  for (let world = first; world <= last; world++) {
    const offset = world * worldWidth
    for (const feature of source.getFeaturesInExtent([extent[0] - offset, extent[1], extent[2] - offset, extent[3]])) result.add(feature)
  }
  return [...result]
}

/** Align the drag quadrilateral with the axes, then use OL's geometry intersection (including holes). */
export function intersectsSelectionBox(geometry: Geometry, box: Polygon, worldWidth?: number, clipExtent?: Extent): boolean {
  const ring = box.getCoordinates()[0]
  if (!ring || ring.length < 4 || !box.getExtent().every(Number.isFinite) || !geometry.getExtent().every(Number.isFinite)) return false
  if (clipExtent && (clipExtent[0] > clipExtent[2] || clipExtent[1] > clipExtent[3])) return false
  const clipped = clipExtent ? clipRing(ring, clipExtent) : undefined
  if (clipped?.length === 0) return false
  const angle = Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0])
  const anchor = ring[0]
  const aligned = box.clone()
  aligned.rotate(-angle, anchor)
  const extent = aligned.getExtent()
  const candidateExtent = geometry.getExtent()
  const boxExtent = box.getExtent()
  let first = 0, last = 0
  if (worldWidth && Number.isFinite(worldWidth) && worldWidth > 0) {
    first = Math.ceil((boxExtent[0] - candidateExtent[2]) / worldWidth)
    last = Math.floor((boxExtent[2] - candidateExtent[0]) / worldWidth)
  }
  for (let world = first; world <= last; world++) {
    const candidate = geometry.clone()
    if (world) candidate.translate(world * (worldWidth ?? 0), 0)
    if (clipped) {
      if (intersectsClippedRing(candidate, clipped)) return true
      continue
    }
    candidate.rotate(-angle, anchor)
    if (candidate.intersectsExtent(extent)) return true
  }
  return false
}
