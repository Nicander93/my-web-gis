import TileLayer from 'ol/layer/Tile'
import TileWMS from 'ol/source/TileWMS'
import type { WmsDataset } from '@desktop-webgis/gis-core'

export const GIS_WMS_EXTENT_KEY = 'gisBboxWgs84'
export const GIS_WMS_LAYER_ID_KEY = 'gisLayerId'
export const GIS_WMS_DATASET_ID_KEY = 'gisDatasetId'

export interface CreateWmsLayerOptions {
  layerId: string
  dataset: WmsDataset
  visible?: boolean
  opacity?: number
  zIndex?: number
  /**
   * Optional absolute GetMap URL overrides for auth (query token already applied).
   * Prefer shareable Dataset URL + session credential injection by the caller.
   */
  requestUrl?: string
  /** Extra WMS params (never include secrets in Dataset; pass tokens only at request time). */
  extraParams?: Record<string, string>
}

/**
 * Build an OpenLayers TileLayer + TileWMS from a WMS Dataset.
 * Relies on OL official source for VERSION / CRS|SRS / BBOX axis order.
 */
export function createWmsTileLayer(options: CreateWmsLayerOptions): TileLayer<TileWMS> {
  const { dataset, layerId } = options
  const source = dataset.source
  const params: Record<string, string> = {
    LAYERS: source.layerNames.join(','),
    STYLES: (source.styleNames ?? []).join(','),
    FORMAT: source.format ?? 'image/png',
    TRANSPARENT: source.transparent === false ? 'FALSE' : 'TRUE',
    VERSION: source.version || '1.3.0',
    ...(options.extraParams ?? {})
  }

  const tileSource = new TileWMS({
    url: options.requestUrl ?? source.url,
    params,
    // Prefer server-native CRS when persisted; else let OL use the view projection.
    projection: source.crs,
    crossOrigin: 'anonymous',
    transition: 0
  })

  const layer = new TileLayer({
    source: tileSource,
    visible: options.visible ?? true,
    opacity: options.opacity ?? 1,
    zIndex: options.zIndex
  })
  layer.set(GIS_WMS_LAYER_ID_KEY, layerId)
  layer.set(GIS_WMS_DATASET_ID_KEY, dataset.id)
  if (source.bboxWgs84) {
    layer.set(GIS_WMS_EXTENT_KEY, source.bboxWgs84.slice() as [number, number, number, number])
  }
  return layer
}

/** Force TileWMS to re-request tiles (retry after transient failure). */
export function refreshWmsTileLayer(layer: TileLayer<TileWMS>): void {
  const source = layer.getSource()
  if (!source) return
  // Bump a cache-busting param so browsers/OL do not reuse a failed tile response.
  const params = { ...source.getParams(), _retry: String(Date.now()) }
  source.updateParams(params)
  source.refresh()
}
