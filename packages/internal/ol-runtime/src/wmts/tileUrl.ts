import type WMTS from 'ol/source/WMTS'
import type { TileCoord } from 'ol/tilecoord'

/** 按给定的瓦片坐标，解析 WMTS 数据源的瓦片 URL。 */
export function getWmtsTileUrl(source: WMTS, tileCoord: TileCoord, pixelRatio = 1): string | undefined {
  const fn = source.getTileUrlFunction()
  if (!fn) return undefined
  const url = fn(tileCoord, pixelRatio, source.getProjection()!)
  return url ?? undefined
}
