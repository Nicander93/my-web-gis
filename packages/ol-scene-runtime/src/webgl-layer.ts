import type Feature from 'ol/Feature.js'
import type Geometry from 'ol/geom/Geometry.js'
import LayerGroup from 'ol/layer/Group.js'
import type VectorLayer from 'ol/layer/Vector.js'
import WebGLVectorLayer from 'ol/layer/WebGLVector.js'
import type VectorSource from 'ol/source/Vector.js'
import type { WebGLStylePlan } from '@desktop-webgis/ol-style/cartography'

/** Probe the same WebGL 1 context used by pinned OL; never changes project data. */
export function isWebGLAvailable(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return false
    const supported = !!gl.getExtension('OES_element_index_uint') && !!gl.getExtension('ANGLE_instanced_arrays')
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return supported
  } catch { return false }
}

export interface WebGLLayerBinding {
  group: LayerGroup
  sync(): void
  dispose(): void
}

/** Source remains host-owned. Canvas is retained only as a ready fallback after context loss. */
export function createWebGLLayerBinding(canvas: VectorLayer<VectorSource<Feature<Geometry>>>, plan: WebGLStylePlan, onFallback: () => void): WebGLLayerBinding {
  if (!plan.supported) throw new Error('Cannot render an unsupported WebGL plan')
  const native = plan.layers.map(layer => new WebGLVectorLayer({ source: canvas.getSource()!, style: layer.rules, properties: { sceneLayerId: canvas.get('sceneLayerId'), drawingLayerId: layer.id } }))
  const group = new LayerGroup({ layers: native, properties: { sceneLayerId: canvas.get('sceneLayerId'), cartographyRenderer: 'webgl' } })
  let disposed = false, failed = false
  const observed = new Map<HTMLCanvasElement, EventListener>()
  function fallback(): void {
    if (disposed || failed) return
    failed = true
    group.getLayers().clear()
    group.getLayers().push(canvas)
    // Presentation belongs to the group; do not multiply opacity on the fallback child.
    canvas.setOpacity(1); canvas.setVisible(true)
    canvas.setMinZoom(-Infinity); canvas.setMaxZoom(Infinity)
    native.forEach(layer => layer.dispose())
    group.set('cartographyRenderer', 'canvas')
    onFallback()
    group.changed()
  }
  native.forEach(layer => layer.on('postrender', event => {
    const element = event.context?.canvas
    if (!(element instanceof HTMLCanvasElement) || observed.has(element) || disposed) return
    const lost: EventListener = event => { event.preventDefault(); fallback() }
    element.addEventListener('webglcontextlost', lost)
    observed.set(element, lost)
  }))
  return {
    group,
    sync() {
      if (disposed) return
      group.setVisible(canvas.getVisible()); group.setOpacity(canvas.getOpacity())
      group.setMinZoom(canvas.getMinZoom()); group.setMaxZoom(canvas.getMaxZoom())
      if (failed) { canvas.setVisible(true); canvas.setOpacity(1); canvas.setMinZoom(-Infinity); canvas.setMaxZoom(Infinity) }
    },
    dispose() {
      if (disposed) return
      disposed = true
      observed.forEach((listener, element) => element.removeEventListener('webglcontextlost', listener))
      observed.clear()
      group.getLayers().clear()
      native.forEach(layer => layer.dispose())
      group.dispose()
    }
  }
}
