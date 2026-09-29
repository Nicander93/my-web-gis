import type WMTS from 'ol/source/WMTS'
import type { TileCoord } from 'ol/tilecoord'

/** Resolve the tile URL for a WMTS source at a given tile coordinate. */
export function getWmtsTileUrl(source: WMTS, tileCoord: TileCoord, pixelRatio = 1): string | undefined {
  const fn = source.getTileUrlFunction()
  if (!fn) return undefined
  const url = fn(tileCoord, pixelRatio, source.getProjection()!)
  return url ?? undefined
}
