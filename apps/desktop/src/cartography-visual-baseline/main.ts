import 'ol/ol.css'
import GeoJSON from 'ol/format/GeoJSON.js'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { createMapLibreCanvasBinding } from '@desktop-webgis/ol-style/cartography'
import type { MapLibreStyleSpecification } from '@desktop-webgis/ol-style/cartography'

interface RenderInput {
  geojson: GeoJSON.FeatureCollection
  layers: MapLibreStyleSpecification['layers']
  extent: [number, number, number, number]
}

declare global {
  interface Window {
    renderCartographyBaseline(input: RenderInput): Promise<void>
  }
}

let activeMap: Map | undefined

window.renderCartographyBaseline = async ({ geojson, layers, extent }) => {
  const target = document.querySelector<HTMLElement>('#map')
  if (!target) throw new Error('Baseline map target is missing')
  activeMap?.setTarget(undefined)
  target.replaceChildren()

  const source = new VectorSource({
    features: new GeoJSON().readFeatures(geojson, {
      dataProjection: 'EPSG:4326',
      featureProjection: 'EPSG:3857'
    })
  })
  const vectorLayer = new VectorLayer({ source })
  const style: MapLibreStyleSpecification = {
    version: 8,
    sources: { fixture: { type: 'geojson', data: geojson } },
    layers: layers.map(layer => ({ ...structuredClone(layer), ...('source' in layer ? { source: 'fixture' } : {}) }))
  }
  const applied = await createMapLibreCanvasBinding(vectorLayer, { sourceId: 'fixture' }).update(style)
  if (!applied) throw new Error('Canvas style update was superseded')

  const [minX, minY, maxX, maxY] = extent
  const map = new Map({
    target,
    pixelRatio: 1,
    layers: [vectorLayer],
    view: new View({
      projection: 'EPSG:3857',
      center: [(minX + maxX) / 2, (minY + maxY) / 2],
      resolution: (maxX - minX) / 256,
      rotation: 0,
      constrainResolution: false,
      showFullExtent: true
    })
  })
  activeMap = map
  await document.fonts.ready
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('OpenLayers render timed out')), 10_000)
    map.once('rendercomplete', () => { clearTimeout(timeout); resolve() })
    map.renderSync()
  })
}

document.documentElement.dataset.ready = 'true'
