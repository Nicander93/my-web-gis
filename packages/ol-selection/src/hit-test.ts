import type Geometry from 'ol/geom/Geometry.js'
import type Polygon from 'ol/geom/Polygon.js'
import type VectorSource from 'ol/source/Vector.js'
import type { FeatureLike } from 'ol/Feature.js'

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
export function intersectsSelectionBox(geometry: Geometry, box: Polygon, worldWidth?: number): boolean {
  const ring = box.getCoordinates()[0]
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
    candidate.rotate(-angle, anchor)
    if (candidate.intersectsExtent(extent)) return true
  }
  return false
}
