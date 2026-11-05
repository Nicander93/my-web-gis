import TileLayer from 'ol/layer/Tile'
import TileWMS from 'ol/source/TileWMS'
import type { WmsDataset } from '@desktop-webgis/project'

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
   * 可选：用绝对 GetMap URL 覆盖认证部分，查询 token 已经加好了。
   * 优先使用可分享的 Dataset URL，由调用方注入会话凭据。
   */
  requestUrl?: string
  /** 额外的 WMS 参数。Dataset 里绝不包含密钥，token 只在请求时传入。 */
  extraParams?: Record<string, string>
}

/**
 * 根据 WMS 数据集构造 OpenLayers 的 TileLayer 和 TileWMS。
 * VERSION、CRS 与 SRS 以及 BBOX 的坐标轴顺序，都交给 OpenLayers 官方实现。
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
    // 有持久化值时优先使用服务端原生的 CRS，否则让 OpenLayers 用视图的投影。
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

/** 强制 TileWMS 重新请求瓦片，用于瞬时失败后的重试。 */
export function refreshWmsTileLayer(layer: TileLayer<TileWMS>): void {
  const source = layer.getSource()
  if (!source) return
  // 加一个破坏缓存的参数，避免浏览器或 OpenLayers 复用失败的瓦片响应。
  const params = { ...source.getParams(), _retry: String(Date.now()) }
  source.updateParams(params)
  source.refresh()
}
