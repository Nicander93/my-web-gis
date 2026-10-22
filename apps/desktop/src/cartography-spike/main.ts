import 'ol/ol.css'
import { createMapLibreCanvasBinding } from '@desktop-webgis/ol-style/cartography'
import Feature from 'ol/Feature.js'
import Map from 'ol/Map.js'
import LineString from 'ol/geom/LineString.js'
import Modify from 'ol/interaction/Modify.js'
import Select from 'ol/interaction/Select.js'
import { Fill, Icon, Stroke, Style, Text } from 'ol/style.js'
import View from 'ol/View.js'
import VectorLayer from 'ol/layer/Vector.js'
import { createCartographySources, cartographyStyle } from './fixtures.js'
import VectorSource from 'ol/source/Vector.js'
import type { MapLibreStyleSpecification as StyleSpecification } from '@desktop-webgis/ol-style/cartography'

const sources = createCartographySources()
const localIcon = await loadImage('/cartography-assets/clinic.svg')
const spriteImage = await loadImage('/cartography-assets/sprite.png')
const patternCanvas = document.createElement('canvas')
patternCanvas.width = spriteImage.naturalWidth
patternCanvas.height = spriteImage.naturalHeight
const patternContext = patternCanvas.getContext('2d')
if (!patternContext) throw new Error('无法创建本地 sprite Canvas')
patternContext.drawImage(spriteImage, 0, 0)
const parcelPattern = patternContext.createPattern(patternCanvas, 'repeat')
if (!parcelPattern) throw new Error('无法创建地块重复图案')
const styleUrl = `${location.origin}/cartography-spike.html`
const layers = {
  parcels: new VectorLayer({ source: sources.parcels, opacity: 1 }),
  rivers: new VectorLayer({ source: sources.rivers, opacity: 1 }),
  roads: new VectorLayer({ source: sources.roads, opacity: 1, declutter: true }),
  places: new VectorLayer({ source: sources.places, opacity: 1, declutter: true }),
}
for (const [name, layer] of Object.entries(layers)) layer.set('spike-id', name)
const bindings = Object.fromEntries(Object.entries(layers).map(([sourceId, layer]) => [sourceId,
  createMapLibreCanvasBinding(layer, {
    sourceId,
    styleUrl,
    webfonts: '/cartography-assets/fonts/{font-family}/{fontweight}{-fontstyle}.css',
    getImage: (_layer, name) => name === 'local-clinic' ? localIcon : undefined,
  }),
]))

const viewOptions = { center: [fromLonLatX(121.472), fromLonLatY(31.226)], zoom: 14, minZoom: 8, maxZoom: 18 }
const map = new Map({
  target: 'spike-map',
  layers: [layers.parcels, layers.rivers, layers.roads, layers.places],
  view: new View(viewOptions),
})
const referenceLayers = {
  parcels: new VectorLayer({ source: sources.parcels, opacity: 0.78, style: new Style({ fill: new Fill({ color: parcelPattern }) }) }),
  rivers: new VectorLayer({ source: sources.rivers, style: (feature) => new Style({ stroke: new Stroke({ color: '#2b86ba', width: 3.5 }), text: new Text({ text: String((feature as Feature).get('name') ?? ''), font: '11px sans-serif', fill: new Fill({ color: '#163d50' }) }) }) }),
  roads: new VectorLayer({ source: sources.roads, declutter: true, style: (feature, resolution) => fixedRoadStyle(feature as Feature, resolution) }),
  places: new VectorLayer({ source: sources.places, declutter: true, style: (feature) => new Style({
    image: new Icon({ img: localIcon, scale: 0.8 }),
    text: new Text({ text: String((feature as Feature).get('name') ?? '').replace(' Community', '\nCommunity'), font: '10px sans-serif', offsetY: 22, fill: new Fill({ color: '#7f2a45' }), stroke: new Stroke({ color: '#ffffff', width: 2 }), overflow: true }),
  }) }),
}
for (const [name, layer] of Object.entries(referenceLayers)) {
  layer.set('reference-id', name)
  layer.setVisible(name === 'roads')
}
const reference = new Map({
  target: 'reference-map',
  layers: [referenceLayers.parcels, referenceLayers.rivers, referenceLayers.roads, referenceLayers.places],
  view: new View(viewOptions),
})
const selection = new Select({ layers: [layers.roads, layers.places] })
const modify = new Modify({ features: selection.getFeatures() })
map.addInteraction(selection)
map.addInteraction(modify)

async function waitForRender(targetMap: Map): Promise<void> {
  await new Promise<void>((resolve) => {
    targetMap.once(['rendercomplete'], () => resolve())
    targetMap.renderSync()
  })
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image()
  image.src = url
  await image.decode()
  return image
}

function fromLonLatX(longitude: number) {
  return (longitude * 20037508.34) / 180
}

function fromLonLatY(latitude: number) {
  const radians = (latitude * Math.PI) / 180
  return (Math.log(Math.tan(Math.PI / 4 + radians / 2)) * 20037508.34) / Math.PI
}

function fixedRoadStyle(feature: Feature, resolution: number) {
  const major = feature.get('kind') === 'primary'
  const zoom = Math.log2(156543.03392804097 / resolution) - 1
  const zoomProgress = Math.max(0, Math.min(1, (zoom - 8) / 8))
  const casingWidth = 5 + zoomProgress * 6
  const innerWidth = 2.5 + zoomProgress * 2.5
  return [
    new Style({ stroke: new Stroke({ color: '#fffdf7', width: casingWidth }), zIndex: 10 }),
    new Style({
      stroke: new Stroke({ color: major ? '#ce7247' : '#e3a94b', width: innerWidth }),
      text: major ? new Text({ text: String(feature.get('name') ?? ''), font: '11px sans-serif', fill: new Fill({ color: '#433f38' }), stroke: new Stroke({ color: '#fffdf7', width: 2 }), placement: 'line', repeat: 500, overflow: true }) : undefined,
      zIndex: 20,
    }),
  ]
}

function withRoadFilter(primaryOnly: boolean): StyleSpecification {
  const next = structuredClone(cartographyStyle)
  if (primaryOnly) {
    next.layers = next.layers.map((layer) => layer.type !== 'background' && layer.source === 'roads'
      ? { ...layer, filter: ['==', ['get', 'kind'], 'primary'] }
      : layer)
  }
  return next
}

const rendered = await Promise.all(Object.entries(bindings).map(async ([sourceId, binding]) => [sourceId, await binding.update(cartographyStyle)] as const))
if (rendered.some(([, accepted]) => !accepted)) throw new Error('初始样式应用被更新请求取代')

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
  button.addEventListener('click', () => {
    const layer = layers[button.dataset.layer as keyof typeof layers]
    const visible = !layer.getVisible()
    layer.setVisible(visible)
    layer.setOpacity(visible ? 1 : 0.35)
    button.setAttribute('aria-pressed', String(visible))
    button.dataset.opacity = String(layer.getOpacity())
  })
}

document.querySelector<HTMLButtonElement>('#filter-local')?.addEventListener('click', async () => {
  await bindings.roads.update(withRoadFilter(true))
  document.body.dataset.roadFilter = 'primary'
})
document.querySelector<HTMLButtonElement>('#reset-filter')?.addEventListener('click', async () => {
  await bindings.roads.update(cartographyStyle)
  document.body.dataset.roadFilter = 'all'
})

declare global {
  interface Window {
    cartographySpike: {
      maps: [Map, Map]
      layers: typeof layers
      referenceLayers: typeof referenceLayers
      sources: typeof sources
      selection: Select
      modify: Modify
      featureIdentity: Feature
      style: StyleSpecification
      showCase: (name: 'classification' | 'casing' | 'icon' | 'labels' | 'pattern') => Promise<void>
      updateRoadStyle: (style?: StyleSpecification) => Promise<boolean>
      renderFixedFeatureCount: (count: number) => Promise<{ count: number; visibleFeatureCount: number; renderPixels: number; compileMs: number; renderMs: number }>
      translateSelectedFeature: (delta: [number, number]) => void
      zoomSamples: () => { olZoom: number; mapLibreZoom: number; resolution: number }[]
    }
  }
}

const featureIdentity = sources.roads.getFeatureById('road-main-west-east')
if (!featureIdentity) throw new Error('固定道路要素缺失')
window.cartographySpike = {
  maps: [map, reference],
  layers,
  referenceLayers,
  sources,
  selection,
  modify,
  featureIdentity,
  style: cartographyStyle,
  updateRoadStyle: (style = cartographyStyle) => bindings.roads.update(style),
  async renderFixedFeatureCount(count) {
    const center = map.getView().getCenter()
    if (!center) throw new Error('地图视图缺少中心点')
    const features = Array.from({ length: count }, (_, index) => {
      const column = index % 40
      const row = Math.floor(index / 40)
      const x = center[0] + (column - 20) * 24
      const y = center[1] + (row - 12) * 24
      const feature = new Feature({
        geometry: new LineString([[x, y], [x + 18, y]]),
        kind: index % 3 === 0 ? 'primary' : 'local',
        name: `fixture-${index}`,
      })
      feature.setId(`perf-${index}`)
      return feature
    })
    const source = new VectorSource({ features })
    const layer = new VectorLayer({ source, declutter: true })
    const binding = createMapLibreCanvasBinding(layer, { sourceId: 'roads', styleUrl, getImage: (_layer, name) => name === 'local-clinic' ? localIcon : undefined })
    const compileStart = performance.now()
    await binding.update(cartographyStyle)
    const compileMs = performance.now() - compileStart
    const target = document.createElement('div')
    target.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:500px'
    document.body.append(target)
    const benchmarkMap = new Map({ target, layers: [layer], view: new View({ center, zoom: map.getView().getZoom() }) })
    const extent = benchmarkMap.getView().calculateExtent(benchmarkMap.getSize())
    const visibleFeatureCount = source.getFeaturesInExtent(extent).length
    const renderStart = performance.now()
    await waitForRender(benchmarkMap)
    const renderPixels = Array.from(target.querySelectorAll('canvas')).reduce((total, canvas) => {
      const context = canvas.getContext('2d')
      if (!context) return total
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let drawn = 0
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) drawn += 1
      return total + drawn
    }, 0)
    const renderMs = performance.now() - renderStart
    benchmarkMap.setTarget(undefined)
    target.remove()
    return { count: source.getFeatures().length, visibleFeatureCount, renderPixels, compileMs, renderMs }
  },
  async showCase(name) {
    for (const key of Object.keys(layers) as (keyof typeof layers)[]) layers[key].setVisible(
      name === 'classification' || name === 'casing' || name === 'labels' ? key === 'roads'
        : name === 'icon' ? key === 'places' : key === 'parcels',
    )
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
      button.setAttribute('aria-pressed', String(layers[button.dataset.layer as keyof typeof layers].getVisible()))
    }
    const referenceSource = name === 'pattern' ? 'parcels' : name === 'icon' ? 'places' : 'roads'
    for (const [sourceId, referenceLayer] of Object.entries(referenceLayers)) referenceLayer.setVisible(sourceId === referenceSource)
    const next = structuredClone(cartographyStyle)
    next.layers = next.layers.map((layer) => {
      if (layer.type === 'background' || layer.source !== 'roads') return layer
      if (name === 'classification' || name === 'casing') return layer.id === 'road-labels'
        ? { ...layer, layout: { ...layer.layout, visibility: 'none' } }
        : layer
      if (name === 'labels') return layer.id === 'road-labels'
        ? { ...layer, filter: ['==', ['get', 'kind'], 'primary'] }
        : { ...layer, layout: { ...layer.layout, visibility: 'none' } }
      return { ...layer, layout: { ...layer.layout, visibility: 'none' } }
    })
    await bindings.roads.update(next)
    if (name === 'labels' || name === 'icon') await document.fonts.ready
    await Promise.all([waitForRender(map), waitForRender(reference)])
  },
  translateSelectedFeature(delta) {
    const feature = selection.getFeatures().item(0)
    feature?.getGeometry()?.translate(delta[0], delta[1])
  },
  zoomSamples: () => [8, 12, 16].map((mapLibreZoom) => {
    const resolution = 156543.03392804097 / 2 ** (mapLibreZoom + 1)
    return { olZoom: map.getView().getZoomForResolution(resolution) ?? -1, mapLibreZoom, resolution }
  }),
}

await Promise.all([waitForRender(map), waitForRender(reference)])
const status = document.querySelector<HTMLOutputElement>('#status')
if (status) {
  status.value = 'Canvas 渲染就绪 · 4 GIS-like Layers · 7 Style Layers'
  status.dataset.ready = 'true'
}

function fromSource(source: VectorSource) {
  return source.getFeatures().map((feature) => feature.getId())
}
document.body.dataset.sourceIdentity = String(layers.roads.getSource() === sources.roads)
document.body.dataset.featureIdentity = String(layers.roads.getSource()?.getFeatureById('road-main-west-east') === featureIdentity)
document.body.dataset.roads = JSON.stringify(fromSource(sources.roads))
