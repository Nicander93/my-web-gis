import TileLayer from 'ol/layer/Tile'
import WMTS from 'ol/source/WMTS'
import type { WmtsDataset } from '@desktop-webgis/gis-core'
import { buildWmtsTileGrid } from './buildWmtsTileGrid'

export const GIS_WMTS_EXTENT_KEY = 'gisBboxWgs84'
export const GIS_WMTS_LAYER_ID_KEY = 'gisLayerId'
export const GIS_WMTS_DATASET_ID_KEY = 'gisDatasetId'

export interface CreateWmtsLayerOptions {
  layerId: string
  dataset: WmtsDataset
  visible?: boolean
  opacity?: number
  zIndex?: number
  requestUrls?: string[]
}

/**
 * Build an OpenLayers TileLayer + WMTS source from a WMTS Dataset.
 * Tile grid comes from persisted matrix definitions (not hardcoded XYZ).
 */
export function createWmtsTileLayer(options: CreateWmtsLayerOptions): TileLayer<WMTS> {
  const { dataset, layerId } = options
  const source = dataset.source
  if (!source.tileMatrixSet) {
    throw new Error('WMTS Dataset 缺少 tileMatrixSet')
  }
  if (!source.tileMatrices?.length) {
    throw new Error(
      `WMTS Dataset 缺少 TileMatrix 定义（tileMatrixSet=${source.tileMatrixSet}），无法静默改用其他矩阵`
    )
  }

  const projection = source.projection || source.supportedCrs || 'EPSG:3857'
  const { tileGrid, projectionCode } = buildWmtsTileGrid({
    projection,
    tileMatrices: source.tileMatrices
  })

  const urls =
    options.requestUrls?.length
      ? options.requestUrls
      : source.urls?.length
        ? source.urls
        : [source.url]

  const tileSource = new WMTS({
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
  })

  const layer = new TileLayer({
    source: tileSource,
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    zIndex: options.zIndex
  })
  layer.set(GIS_WMTS_LAYER_ID_KEY, layerId)
  layer.set(GIS_WMTS_DATASET_ID_KEY, dataset.id)
  if (source.bboxWgs84) {
    layer.set(GIS_WMTS_EXTENT_KEY, source.bboxWgs84.slice() as [number, number, number, number])
  }
  return layer
}

/** Force WMTS to re-request tiles (retry after transient failure). */
export function refreshWmtsTileLayer(layer: TileLayer<WMTS>): void {
  const source = layer.getSource()
  if (!source) return
  source.refresh()
}
