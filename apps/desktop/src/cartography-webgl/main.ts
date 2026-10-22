import 'ol/ol.css'
import { OlDocumentRuntime } from '../../../../packages/ol-scene-runtime/src/index'
import { CARTOGRAPHY_EXTENSION, type SceneDocument, type JsonValue } from '@desktop-webgis/scene-schema'
import type { MapLibreStyleSpecification } from '@desktop-webgis/ol-style/cartography'
import { BUILTIN_SYMBOL_PRESETS } from '@desktop-webgis/ol-style/symbol-library'
import LayerGroup from 'ol/layer/Group.js'
import VectorLayer from 'ol/layer/Vector.js'
import WebGLVectorLayer from 'ol/layer/WebGLVector.js'

let runtime: OlDocumentRuntime | undefined
let renderRevision = 0
const scene: SceneDocument = {
  version: 3, id: 'gpu', title: 'GPU acceptance', activeView: 'map',
  views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 8 } },
  resources: { data: { type: 'geojson', dataProjection: 'EPSG:3857', data: { type: 'FeatureCollection', features: [] } } },
  nodes: [{ id: 'points', type: 'vector', resource: 'data', name: 'Points', visible: true, style: { mode: 'single', symbol: { type: 'circle', radius: 4, fill: { r: 0, g: 100, b: 200, a: 1 } } } }]
}

declare global { interface Window { cartographyWebGL: typeof api } }
const api = {
  async render(renderer: 'canvas' | 'webgl', count = 1000, mode: 'circle' | 'line' | 'fill' | 'label' | 'road' = 'circle', interactive = false) {
    runtime?.destroy()
    const input = structuredClone(scene), resource = input.resources.data
    if (resource.type !== 'geojson' || !resource.data) throw new Error('Fixture missing')
    const side = Math.ceil(Math.sqrt(count)), spacing = 140
    resource.data.features = Array.from({ length: count }, (_, index) => {
      const x = (index % side - side / 2) * spacing, y = (Math.floor(index / side) - side / 2) * spacing
      const geometry = mode === 'line' || mode === 'road' ? { type: 'LineString' as const, coordinates: [[x, y], [x + 90, y + 90]] }
        : mode === 'fill' ? { type: 'Polygon' as const, coordinates: [[[x, y], [x + 100, y], [x + 100, y + 100], [x, y + 100], [x, y]]] }
          : { type: 'Point' as const, coordinates: [x, y] }
      return { type: 'Feature' as const, id: index, geometry, properties: { name: String(index) } }
    })
    const drawing: MapLibreStyleSpecification['layers'][number] = mode === 'line' ? { id: 'draw', source: 'data', type: 'line', paint: { 'line-color': '#c34b36', 'line-width': 3 } }
      : mode === 'fill' ? { id: 'draw', source: 'data', type: 'fill', paint: { 'fill-color': '#47a170', 'fill-opacity': 0.5 } }
        : mode === 'label' ? { id: 'draw', source: 'data', type: 'symbol', layout: { 'text-field': ['get', 'name'], 'text-font': ['sans-serif'], 'text-size': 12 } }
          : { id: 'draw', source: 'data', type: 'circle', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 20, 10], 'circle-color': '#2977b8' } }
    const drawingLayers = mode === 'road' ? structuredClone(BUILTIN_SYMBOL_PRESETS.find(preset => preset.id === 'builtin:road-primary-v1')!.layers).map(layer => ({ ...layer, source: 'data' })) : [drawing]
    if (input.nodes[0].type === 'vector' && interactive) input.nodes[0].interaction = { selectable: true }
    const cartography = { specVersion: 8, styleLayers: drawingLayers, bindings: [{ gisLayerId: 'points', datasetId: 'data', styleSourceId: 'data', styleLayerIds: drawingLayers.map(layer => layer.id) }] }
    input.extensions = { [CARTOGRAPHY_EXTENSION]: { version: 1, required: true, data: JSON.parse(JSON.stringify(cartography)) as JsonValue } }
    const start = performance.now()
    runtime = new OlDocumentRuntime({ target: 'map', vectorRenderer: renderer })
    await runtime.loadDocument(input)
    const prepared = performance.now()
    const map = runtime.getNativeMap()
    map.getView().setResolution(Math.max(3000, side * spacing * 1.1) / 512)
    const layer = runtime.getLayer('points')
    const children = layer instanceof LayerGroup ? layer.getLayers().getArray() : [layer]
    let coloredPixels = 0, gpuRenderer = '', samplingPixels = true
    children.forEach(child => {
      if (!(child instanceof WebGLVectorLayer)) return
      child.on('postrender', event => {
        if (!samplingPixels) return
        const gl = event.context as WebGLRenderingContext
        const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
        coloredPixels = 0
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) coloredPixels++
        const debug = gl.getExtension('WEBGL_debug_renderer_info')
        gpuRenderer = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
      })
    })
    await api.frame()
    const firstRenderMs = performance.now() - prepared
    samplingPixels = false
    if (layer instanceof VectorLayer) {
      coloredPixels = Array.from(document.querySelectorAll<HTMLCanvasElement>('#map canvas')).reduce((sum, canvas) => {
        const pixels = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data
        if (!pixels) return sum
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) sum++
        return sum
      }, 0)
    }
    const frames: number[] = []
    for (let index = 0; index < 5; index++) {
      const before = performance.now()
      map.getView().setCenter([index * 5, 0])
      await api.frame()
      frames.push(performance.now() - before)
    }
    renderRevision++
    return { requested: renderer, actual: layer?.get('cartographyRenderer') ?? 'canvas', count, mode, coloredPixels, gpuRenderer, prepareMs: prepared - start, firstRenderMs, frames, issues: runtime.getIssues(), revision: renderRevision, nativeFeatureCount: runtime.getFilteredFeatures('points').length }
  },
  async frame() {
    if (!runtime) throw new Error('No runtime')
    const map = runtime.getNativeMap()
    await new Promise<void>(resolve => { map.once('rendercomplete', () => resolve()); map.renderSync() })
  },
  async hide() {
    if (!runtime) throw new Error('No runtime')
    const document = runtime.getDocument()!
    document.nodes[0].visible = false
    await runtime.updateDocument(document)
    await api.frame()
    return runtime.getLayer('points')?.getVisible()
  },
  async loseContext() {
    const canvas = document.querySelector<HTMLCanvasElement>('#map canvas')!
    const extension = canvas.getContext('webgl')?.getExtension('WEBGL_lose_context')
    if (!extension) throw new Error('Context loss extension unavailable')
    const lost = new Promise<void>(resolve => canvas.addEventListener('webglcontextlost', () => resolve(), { once: true }))
    extension.loseContext()
    await lost
    await api.frame()
    return { renderer: runtime?.getLayer('points')?.get('cartographyRenderer'), issues: runtime?.getIssues(), count: runtime?.getFilteredFeatures('points').length }
  },
  dispose() { runtime?.destroy(); runtime = undefined; return document.querySelectorAll('#map canvas').length }
}
window.cartographyWebGL = api
