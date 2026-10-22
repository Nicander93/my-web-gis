import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import LineString from 'ol/geom/LineString.js'
import Polygon from 'ol/geom/Polygon.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { toContext } from 'ol/render.js'
import { unByKey } from 'ol/Observable.js'
import type { LayerSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { ProjectStyleAsset } from './style-assets.js'
import { prepareCartographyResources } from './cartography-resources.js'
import { createMapLibreCanvasBinding } from './maplibre-adapter.js'

/** Uses the product renderer for a symbol swatch, including casing, icons and patterns. */
export async function createCartographyPreview(canvas: HTMLCanvasElement, options: {
  layers: readonly LayerSpecification[]; assets: readonly ProjectStyleAsset[]; geometry: 'point' | 'line' | 'polygon'; zoom?: number; properties?: Record<string, unknown>
}): Promise<() => void> {
  const resources = options.assets.length ? await prepareCartographyResources(options.assets) : undefined
  const source = new VectorSource(), layer = new VectorLayer({ source })
  const width = canvas.width, height = canvas.height
  const geometry = options.geometry === 'point' ? new Point([width / 2, height / 2]) : options.geometry === 'line'
    ? new LineString([[5, height * 0.65], [width * 0.45, height * 0.3], [width - 5, height * 0.65]])
    : new Polygon([[[5, 5], [width - 5, 5], [width - 5, height - 5], [5, height - 5], [5, 5]]])
  const feature = new Feature({ geometry, name: '示例', ...options.properties })
  const context = canvas.getContext('2d')
  if (!context) { resources?.dispose(); throw new Error('无法创建符号预览 Canvas') }
  const renderer = toContext(context, { size: [width, height], pixelRatio: 1 })
  function draw() {
    context!.clearRect(0, 0, width, height)
    const result = layer.getStyleFunction()?.(feature, 78271.51696402048 / 2 ** (options.zoom ?? 10))
    for (const style of result ? Array.isArray(result) ? result : [result] : []) {
      renderer.setStyle(style); renderer.drawFeature(feature, style)
    }
  }
  const listener = layer.on('change', draw)
  const dispose = () => { unByKey(listener); layer.dispose(); source.dispose(); resources?.dispose() }
  try {
    await createMapLibreCanvasBinding(layer, { sourceId: 'preview', transformRequest: resources?.transformRequest }).update({ version: 8,
      sources: { preview: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: options.layers.map(drawing => ({ ...structuredClone(drawing), ...('source' in drawing ? { source: 'preview' } : {}) })),
      ...(resources?.sprite ? { sprite: resources.sprite } : {}),
    })
    draw()
    return dispose
  } catch (error) { dispose(); throw error }
}
