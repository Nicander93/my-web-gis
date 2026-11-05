import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { applyStyle } from 'ol-mapbox-style'
import type VectorLayer from 'ol/layer/Vector.js'
import type VectorTileLayer from 'ol/layer/VectorTile.js'
import type VectorSource from 'ol/source/Vector.js'
export type { StyleSpecification as MapLibreStyleSpecification } from '@maplibre/maplibre-gl-style-spec'

export interface MapLibreCanvasBindingOptions {
  sourceId: string
  /** 即使多个图层共用一个数据源，每个 GIS 图层也只拥有其中一个子集。 */
  layerIds?: readonly string[]
  getImage?: (layer: VectorLayer | VectorTileLayer, name: string) => HTMLImageElement | HTMLCanvasElement | string | undefined
  resolutions?: number[]
  styleUrl?: string
  webfonts?: string
  transformRequest?: (url: string, type: string) => Promise<Response> | undefined
}

export interface MapLibreCanvasBinding {
  /** 返回 false 表示有更新的请求取代了这次更新。挂起的输入会合并。 */
  update(style: StyleSpecification): Promise<boolean>
}

/** 使用锁定版本的 MapLibre 校验器；渲染器支持情况由 P0 的夹具单独检查。 */
export function validateMapLibreStyle(style: StyleSpecification): string[] {
  return validateStyleMin(style).map((error) => error.message)
}

/** 把 v8 样式层应用到已有的 OL 矢量图层上，不转移数据源的归属。 */
export function createMapLibreCanvasBinding(
  target: VectorLayer<VectorSource>,
  options: MapLibreCanvasBindingOptions,
): MapLibreCanvasBinding {
  const source = target.getSource()
  if (!source) throw new Error('目标 VectorLayer 必须已有 VectorSource')

  let revision = 0
  let pending: Promise<unknown> = Promise.resolve()
  return {
    async update(style) {
      const errors = validateMapLibreStyle(style)
      if (errors.length) throw new Error(`MapLibre Style v8 校验失败：${errors.join('; ')}`)
      if (style.sources[options.sourceId]?.type !== 'geojson') {
        throw new Error(`当前 Canvas Spike 需要 GeoJSON source：${options.sourceId}`)
      }
      if (options.layerIds?.some(id => !style.layers.some(layer => layer.id === id && 'source' in layer && layer.source === options.sourceId))) {
        throw new Error('绑定的 Style Layer 不存在或 source 不一致')
      }

      const requestRevision = ++revision
      const snapshot = structuredClone(style)
      // 适配器会分配一个私有的根 ID，并按它缓存表达式。
      // 新的快照不能复用那个 ID，也不能修改项目文档。
      Reflect.deleteProperty(snapshot, 'id')

      const result = pending.then(async () => {
        if (requestRevision !== revision) return false
        if (options.layerIds?.length === 0) { target.setStyle(() => undefined); return true }
        // applyStyle 在加载资源的过程中就会改动图层。把它串行化可以
        // 防止较早的资源响应覆盖较新的样式。
        await applyStyle(target, snapshot, {
          ...(options.layerIds ? { layers: [...options.layerIds] } : { source: options.sourceId }),
          updateSource: false,
          getImage: options.getImage,
          resolutions: options.resolutions,
          styleUrl: options.styleUrl,
          webfonts: options.webfonts,
          transformRequest: options.transformRequest,
        })

        return requestRevision === revision
      })
      pending = result.catch(() => undefined)
      return result
    },
  }
}
