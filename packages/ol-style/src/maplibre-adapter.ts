import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { applyStyle } from 'ol-mapbox-style'
import type VectorLayer from 'ol/layer/Vector.js'
import type VectorTileLayer from 'ol/layer/VectorTile.js'
import type VectorSource from 'ol/source/Vector.js'
export type { StyleSpecification as MapLibreStyleSpecification } from '@maplibre/maplibre-gl-style-spec'

export interface MapLibreCanvasBindingOptions {
  sourceId: string
  /** A GIS layer owns a subset even when several layers share the same source. */
  layerIds?: readonly string[]
  getImage?: (layer: VectorLayer | VectorTileLayer, name: string) => HTMLImageElement | HTMLCanvasElement | string | undefined
  resolutions?: number[]
  styleUrl?: string
  webfonts?: string
  transformRequest?: (url: string, type: string) => Promise<Response> | undefined
}

export interface MapLibreCanvasBinding {
  /** False means a newer request superseded this update. Pending inputs coalesce. */
  update(style: StyleSpecification): Promise<boolean>
}

/** Uses the pinned MapLibre validator; renderer support is checked separately by P0 fixtures. */
export function validateMapLibreStyle(style: StyleSpecification): string[] {
  return validateStyleMin(style).map((error) => error.message)
}

/** Applies v8 layers to an existing OL vector layer without transferring source ownership. */
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
      // The adapter assigns a private root id and caches expressions by it.
      // A fresh snapshot must not reuse that id or mutate the project document.
      Reflect.deleteProperty(snapshot, 'id')

      const result = pending.then(async () => {
        if (requestRevision !== revision) return false
        if (options.layerIds?.length === 0) { target.setStyle(() => undefined); return true }
        // applyStyle changes its layer while loading resources. Serializing it
        // prevents an older resource response from overwriting a newer style.
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
