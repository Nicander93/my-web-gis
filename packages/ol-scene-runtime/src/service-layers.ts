/**
 * Scene WMS / WMTS layer builders for ol-scene-runtime.
 * Mirrors desktop ol-runtime behaviour without pulling gis-core Dataset types.
 */
import TileLayer from 'ol/layer/Tile.js'
import TileWMS from 'ol/source/TileWMS.js'
import WMTS from 'ol/source/WMTS.js'
import WMTSTileGrid from 'ol/tilegrid/WMTS.js'
import { get as getProjection } from 'ol/proj.js'
import type { WmsSceneSource, WmtsSceneSource } from '@desktop-webgis/scene-schema'

function assertFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} 无效`)
  return value
}

/** Build TileGrid from persisted Scene WMTS matrices (no XYZ zoom guessing). */
export function buildSceneWmtsTileGrid(source: WmtsSceneSource): {
  tileGrid: WMTSTileGrid
  projectionCode: string
} {
  const projectionCode = source.projection || source.supportedCrs || 'EPSG:3857'
  const projection = getProjection(projectionCode)
  if (!projection) {
    throw new Error(`WMTS 投影 “${projectionCode}” 不受支持`)
  }
  if (!source.tileMatrices.length) {
    throw new Error(`WMTS Source 缺少 TileMatrix，无法静默改用其他矩阵`)
  }

  const metersPerUnit = projection.getMetersPerUnit() ?? 1
  const scaleToResolution = (scaleDenominator: number, tileWidth: number): number => {
    // OGC: resolution = scaleDenominator * 0.00028 / metersPerUnit (0.28 mm pixel)
    return (assertFinite(scaleDenominator, 'scaleDenominator') * 0.00028) / metersPerUnit
  }

  const sorted = [...source.tileMatrices].sort(
    (a, b) => b.scaleDenominator - a.scaleDenominator
  )
  const resolutions = sorted.map((m) => scaleToResolution(m.scaleDenominator, m.tileWidth))
  const matrixIds = sorted.map((m) => m.identifier)
  const origin = sorted[0]!.topLeftCorner
  const tileSize = [sorted[0]!.tileWidth, sorted[0]!.tileHeight] as [number, number]

  const tileGrid = new WMTSTileGrid({
    origin,
    resolutions,
    matrixIds,
    tileSize
  })
  return { tileGrid, projectionCode }
}

export function createSceneWmsLayer(
  source: WmsSceneSource,
  options: { visible?: boolean; opacity?: number; zIndex?: number } = {}
): TileLayer<TileWMS> {
  const params: Record<string, string> = {
    LAYERS: source.layerNames.join(','),
    STYLES: (source.styleNames ?? []).join(','),
    FORMAT: source.format ?? 'image/png',
    TRANSPARENT: source.transparent === false ? 'FALSE' : 'TRUE',
    VERSION: source.version || '1.3.0'
  }
  return new TileLayer({
    source: new TileWMS({
      url: source.url,
      params,
      projection: source.crs,
      crossOrigin: 'anonymous',
      transition: 0
    }),
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    zIndex: options.zIndex
  })
}

export function createSceneWmtsLayer(
  source: WmtsSceneSource,
  options: { visible?: boolean; opacity?: number; zIndex?: number } = {}
): TileLayer<WMTS> {
  const { tileGrid, projectionCode } = buildSceneWmtsTileGrid(source)
  const urls = source.urls?.length ? source.urls : [source.url]
  return new TileLayer({
    source: new WMTS({
      urls,
      layer: source.layer,
      matrixSet: source.tileMatrixSet,
      format: source.format ?? 'image/png',
      projection: projectionCode,
      requestEncoding: source.requestEncoding || 'KVP',
      tileGrid,
      style: source.style ?? 'default',
      crossOrigin: 'anonymous',
      transition: 0,
      wrapX: false
    }),
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    zIndex: options.zIndex
  })
}
