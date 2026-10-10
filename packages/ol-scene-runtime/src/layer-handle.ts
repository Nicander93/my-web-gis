import type { SceneLayer, SceneSource } from '@desktop-webgis/scene-schema'
import type BaseLayer from 'ol/layer/Base.js'
import LayerGroup from 'ol/layer/Group.js'
import VectorLayer from 'ol/layer/Vector.js'
import type View from 'ol/View.js'
import { createOlSceneLayer, type CreateOlSceneLayerOptions } from './layer.js'
import { createOlStyleFunction } from './style.js'

export interface OlLayerHandle {
  readonly layer: BaseLayer
  /** Updates presentation without replacing the native layer or its source. */
  update(definition: SceneLayer): void
  /** Caller removes the layer from its map before disposal. Idempotent. */
  dispose(): void
}

/** Resolves when native objects are created, not when remote data or tiles have loaded. */
export async function createOlLayerHandle(
  definition: SceneLayer,
  sources: Record<string, SceneSource>,
  view: View,
  options: CreateOlSceneLayerOptions = {}
): Promise<OlLayerHandle> {
  const layer = await createOlSceneLayer(definition, sources, view, options)
  let disposed = false
  function disposeLayer(current: BaseLayer): void {
    if (current instanceof LayerGroup) current.getLayers().forEach(disposeLayer)
    if ('getSource' in current && typeof current.getSource === 'function') {
      const source = current.getSource()
      if (source && source !== options.vectorSource) source.dispose()
    }
    current.dispose()
  }
  function dispose(): void {
    if (disposed) return
    disposed = true
    disposeLayer(layer)
  }
  if (options.signal?.aborted) { dispose(); options.signal.throwIfAborted() }
  return {
    layer,
    update(next) {
      if (disposed) throw new Error('Layer handle has been disposed')
      if (next.id !== definition.id || next.type !== definition.type || next.source !== definition.source) throw new Error('Changing identity, type or resource requires creating a new layer handle')
      if (next.opacity !== undefined && (!Number.isFinite(next.opacity) || next.opacity < 0 || next.opacity > 1)) throw new RangeError('opacity must be between 0 and 1')
      const style = next.type === 'vector' ? createOlStyleFunction(next.style) : undefined
      layer.setVisible(next.visible ?? true)
      layer.setOpacity(next.opacity ?? 1)
      layer.setMinZoom(next.minZoom ?? Number.NEGATIVE_INFINITY)
      layer.setMaxZoom(next.maxZoom ?? Number.POSITIVE_INFINITY)
      if (style && layer instanceof VectorLayer) layer.setStyle(style)
    },
    dispose
  }
}
