import type { GeoJsonFeature, SceneManifest, SceneView } from '@desktop-webgis/scene-schema'

export type SceneTarget = HTMLElement | string

export interface CreateSceneRuntimeOptions {
  target: SceneTarget
  scene?: SceneManifest | string
  fetch?: typeof globalThis.fetch
  credentials?: Record<string, string>
}

export interface RuntimeLayerEvent {
  layerId: string
}

export interface RuntimeLayerErrorEvent extends RuntimeLayerEvent {
  error: Error
}

export interface RuntimeFeatureClickEvent {
  layerId: string
  featureId: string | null
  feature: GeoJsonFeature
  coordinate: [number, number]
}

export interface RuntimeSelectionChangeEvent {
  layerId: string | null
  featureIds: string[]
}

export interface RuntimeSceneErrorEvent {
  error: Error
}

export interface SceneRuntimeEventMap {
  'scene:ready': { scene: SceneManifest }
  'scene:error': RuntimeSceneErrorEvent
  'layer:loadstart': RuntimeLayerEvent
  'layer:loadend': RuntimeLayerEvent
  'layer:error': RuntimeLayerErrorEvent
  'feature:click': RuntimeFeatureClickEvent
  'selection:change': RuntimeSelectionChangeEvent
  'view:change': { view: SceneView }
}

export type SceneRuntimeEvent = keyof SceneRuntimeEventMap
export type Unsubscribe = () => void

export interface SceneRuntime {
  loadScene(scene: SceneManifest | string): Promise<void>
  updateScene(scene: SceneManifest): Promise<void>
  setLayerVisible(layerId: string, visible: boolean): void
  setLayerOpacity(layerId: string, opacity: number): void
  fitToLayer(layerId: string): Promise<void>
  selectFeatures(layerId: string, featureIds: string[]): void
  on<K extends SceneRuntimeEvent>(
    type: K,
    listener: (event: SceneRuntimeEventMap[K]) => void
  ): Unsubscribe
  getNativeMap(): unknown
  destroy(): void
}
