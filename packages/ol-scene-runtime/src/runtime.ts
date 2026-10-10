import { parseScene, type GeoJsonFeature, type SceneLayer, type SceneManifest, type SceneView } from '@desktop-webgis/scene-schema'
import type Feature from 'ol/Feature.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import type Geometry from 'ol/geom/Geometry.js'
import Map from 'ol/Map.js'
import { unByKey } from 'ol/Observable.js'
import View from 'ol/View.js'
import { defaults as defaultControls, FullScreen, MousePosition, ScaleLine } from 'ol/control.js'
import { isEmpty } from 'ol/extent.js'
import Select from 'ol/interaction/Select.js'
import type BaseLayer from 'ol/layer/Base.js'
import VectorLayer from 'ol/layer/Vector.js'
import type VectorSource from 'ol/source/Vector.js'
import type { EventsKey } from 'ol/events.js'
import {
  SCENE_LAYER_ID,
  updateGoogleMapTilesAttribution
} from './layer.js'
import { createOlLayerHandle, type OlLayerHandle } from './layer-handle.js'
import { createOlStyleFunction } from './style.js'
import type {
  CreateSceneRuntimeOptions,
  SceneRuntime,
  SceneRuntimeEvent,
  SceneRuntimeEventMap,
  Unsubscribe
} from './types.js'

type Listener = (event: never) => void

function toSceneView(view: View): SceneView {
  const center = view.getCenter() ?? [0, 0]
  return {
    projection: view.getProjection().getCode(),
    center: [center[0] ?? 0, center[1] ?? 0],
    zoom: view.getZoom() ?? 0,
    rotation: view.getRotation(),
    ...(view.getMinZoom() !== undefined ? { minZoom: view.getMinZoom() } : {}),
    ...(view.getMaxZoom() !== undefined ? { maxZoom: view.getMaxZoom() } : {})
  }
}

function toGeoJsonFeature(feature: Feature<Geometry>, projection: string): GeoJsonFeature {
  const writer = new GeoJSON()
  return writer.writeFeatureObject(feature, {
    featureProjection: projection,
    dataProjection: projection
  }) as GeoJsonFeature
}

function createView(scene: SceneManifest): View {
  return new View({
    projection: scene.view.projection,
    center: scene.view.center,
    zoom: scene.view.zoom,
    rotation: scene.view.rotation,
    minZoom: scene.view.minZoom,
    maxZoom: scene.view.maxZoom,
    extent: scene.view.extent
  })
}

export class OlSceneRuntime implements SceneRuntime {
  private readonly map: Map
  private readonly ownsMap: boolean
  private readonly mapEventKeys: EventsKey[] = []
  private readonly fetcher: typeof globalThis.fetch | undefined
  private readonly credentials: Record<string, string>
  private readonly listeners = new globalThis.Map<SceneRuntimeEvent, Set<Listener>>()
  private readonly layers = new globalThis.Map<string, BaseLayer>()
  private readonly layerHandles = new globalThis.Map<string, OlLayerHandle>()
  private scene: SceneManifest | null = null
  private selectInteraction: Select | null = null
  private loadController: AbortController | null = null
  private destroyed = false

  constructor(options: CreateSceneRuntimeOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch
    this.credentials = { ...(options.credentials ?? {}) }
    this.ownsMap = !options.map
    if (!options.map && !options.target) throw new Error('Provide a map or target')
    this.map = options.map ?? new Map({
      target: options.target,
      layers: [],
      controls: [],
      view: new View({ projection: 'EPSG:3857', center: [0, 0], zoom: 2 })
    })
    this.mapEventKeys.push(this.map.on('moveend', () => {
      this.emit('view:change', { view: toSceneView(this.map.getView()) })
      void this.refreshProviderAttributions()
    }))
    this.mapEventKeys.push(this.map.on('singleclick', (event) => this.handleFeatureClick(event.pixel, event.coordinate)))
  }

  async loadScene(input: SceneManifest | string): Promise<void> {
    if (this.destroyed) throw new Error('Scene runtime has been destroyed')
    this.loadController?.abort()
    const controller = new AbortController()
    this.loadController = controller
    try {
      const scene = await this.resolveScene(input, controller.signal)
      controller.signal.throwIfAborted()
      await this.applyScene(scene, controller.signal)
      controller.signal.throwIfAborted()
      this.emit('scene:ready', { scene: structuredClone(scene) })
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      if (!controller.signal.aborted) this.emit('scene:error', { error: normalized })
      throw normalized
    }
  }

  async updateScene(input: SceneManifest): Promise<void> {
    if (this.destroyed) throw new Error('Scene runtime has been destroyed')
    const scene = parseScene(input), current = this.scene
    const canReuse = current && JSON.stringify(current.sources) === JSON.stringify(scene.sources)
      && JSON.stringify(current.view) === JSON.stringify(scene.view) && JSON.stringify(current.widgets) === JSON.stringify(scene.widgets)
      && scene.layers.length === current.layers.length && scene.layers.every(next => {
        const previous = current.layers.find(layer => layer.id === next.id)
        return previous?.type === next.type && previous.source === next.source
      })
    if (!canReuse) { await this.loadScene(scene); return }
    // Compile all styles before touching native objects so an unsupported style cannot partially apply.
    scene.layers.forEach(layer => { if (layer.type === 'vector') createOlStyleFunction(layer.style) })
    this.loadController?.abort()
    scene.layers.forEach(layer => this.layerHandles.get(layer.id)!.update(layer))
    this.layers.forEach(layer => this.map.removeLayer(layer))
    scene.layers.forEach(layer => this.map.addLayer(this.layers.get(layer.id)!))
    this.scene = scene
    this.emit('scene:ready', { scene: structuredClone(scene) })
  }

  /** Returns declarative content; caller changes never mutate the runtime's scene. */
  getScene(): SceneManifest | null { return this.scene ? structuredClone(this.scene) : null }

  setLayerVisible(layerId: string, visible: boolean): void {
    this.requireLayer(layerId).setVisible(visible)
    const definition = this.findDefinition(layerId)
    if (definition) definition.visible = visible
  }

  setLayerOpacity(layerId: string, opacity: number): void {
    if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new RangeError('opacity 必须处于 0..1')
    }
    this.requireLayer(layerId).setOpacity(opacity)
    const definition = this.findDefinition(layerId)
    if (definition) definition.opacity = opacity
  }

  async fitToLayer(layerId: string): Promise<void> {
    const layer = this.requireLayer(layerId)
    if (!(layer instanceof VectorLayer)) throw new Error(`Layer “${layerId}” 不是可计算范围的 Vector Layer`)
    const source = layer.getSource()
    if (!source) throw new Error(`Layer “${layerId}” 没有 Source`)
    await this.waitForSource(layerId, source)
    const extent = source.getExtent()
    if (isEmpty(extent)) throw new Error(`Layer “${layerId}” 没有可缩放的 Feature`)
    this.map.getView().fit(extent, { padding: [32, 32, 32, 32], duration: 250 })
  }

  selectFeatures(layerId: string, featureIds: string[]): void {
    const layer = this.requireLayer(layerId)
    if (!(layer instanceof VectorLayer)) throw new Error(`Layer “${layerId}” 不是 Vector Layer`)
    const selected = this.selectInteraction?.getFeatures()
    if (!selected) return
    selected.clear()
    const requested = new Set(featureIds)
    for (const feature of layer.getSource()?.getFeatures() ?? []) {
      if (requested.has(String(feature.getId()))) selected.push(feature)
    }
    this.emitSelection()
  }

  on<K extends SceneRuntimeEvent>(
    type: K,
    listener: (event: SceneRuntimeEventMap[K]) => void
  ): Unsubscribe {
    const listeners = this.listeners.get(type) ?? new Set<Listener>()
    listeners.add(listener as Listener)
    this.listeners.set(type, listeners)
    return () => listeners.delete(listener as Listener)
  }

  getNativeMap(): unknown {
    return this.map
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.loadController?.abort()
    this.layers.forEach(layer => this.map.removeLayer(layer))
    unByKey(this.mapEventKeys.filter(Boolean))
    if (this.selectInteraction) this.map.removeInteraction(this.selectInteraction)
    this.layerHandles.forEach(handle => handle.dispose())
    this.layerHandles.clear()
    this.layers.clear()
    this.listeners.clear()
    if (this.ownsMap) {
      this.map.setTarget(undefined)
      this.map.dispose()
    }
    this.scene = null
  }

  private async resolveScene(input: SceneManifest | string, signal: AbortSignal): Promise<SceneManifest> {
    if (typeof input !== 'string') return parseScene(input)
    if (!this.fetcher) throw new Error('当前环境不支持 fetch，无法通过 URL 加载 Scene')
    const response = await this.fetcher(input, { signal })
    if (!response.ok) throw new Error(`Scene 加载失败：HTTP ${response.status}`)
    return parseScene(await response.json())
  }

  private async applyScene(scene: SceneManifest, signal: AbortSignal): Promise<void> {
    const view = createView(scene)
    const prepared = new globalThis.Map<string, OlLayerHandle>()
    try {
      for (const definition of scene.layers) {
        const handle = await createOlLayerHandle(definition, scene.sources, view, {
          credentials: this.credentials, fetch: this.fetcher, signal
        })
        prepared.set(definition.id, handle)
        signal.throwIfAborted()
      }
    } catch (error) {
      prepared.forEach(handle => handle.dispose())
      throw error
    }
    this.scene = scene
    this.layers.forEach(layer => this.map.removeLayer(layer))
    this.layers.clear()
    this.layerHandles.forEach(handle => handle.dispose())
    this.layerHandles.clear()
    if (this.ownsMap) this.map.getControls().clear()
    if (this.selectInteraction) this.map.removeInteraction(this.selectInteraction)

    this.map.setView(view)
    if (this.ownsMap) this.configureControls(scene)

    for (const definition of scene.layers) {
      const handle = prepared.get(definition.id)!
      const layer = handle.layer
      this.layerHandles.set(definition.id, handle)
      this.layers.set(definition.id, layer)
      this.map.addLayer(layer)
      this.observeLayer(definition, layer)
    }

    this.selectInteraction = new Select({
      layers: (layer) => {
        const layerId = layer.get(SCENE_LAYER_ID) as string | undefined
        if (!layerId) return false
        const definition = this.findDefinition(layerId)
        return definition?.type === 'vector' && Boolean(definition.interaction?.selectable)
      }
    })
    this.selectInteraction.on('select', () => this.emitSelection())
    this.map.addInteraction(this.selectInteraction)
    this.map.updateSize()
    await this.refreshProviderAttributions()
  }

  private async refreshProviderAttributions(): Promise<void> {
    for (const [layerId, layer] of this.layers) {
      try {
        await updateGoogleMapTilesAttribution(
          layer,
          this.map.getView(),
          this.map.getSize(),
          this.fetcher
        )
      } catch (error) {
        this.emit('layer:error', {
          layerId,
          error: error instanceof Error ? error : new Error(String(error))
        })
      }
    }
  }

  private configureControls(scene: SceneManifest): void {
    const widgets = scene.widgets ?? {}
    const controls = defaultControls({
      zoom: widgets.zoom ?? true,
      rotate: false,
      attribution: true
    })
    if (widgets.scaleLine) controls.push(new ScaleLine())
    if (widgets.fullscreen) controls.push(new FullScreen())
    if (widgets.mousePosition) controls.push(new MousePosition())
    controls.forEach((control) => this.map.addControl(control))
  }

  private observeLayer(definition: SceneLayer, layer: BaseLayer): void {
    if (!(layer instanceof VectorLayer)) return
    const source = layer.getSource()
    if (!source) return
    if (definition.type === 'vector' && sceneSourceIsInline(this.scene, definition.source)) {
      this.emit('layer:loadend', { layerId: definition.id })
      return
    }
    source.on('featuresloadstart', () => this.emit('layer:loadstart', { layerId: definition.id }))
    source.on('featuresloadend', () => this.emit('layer:loadend', { layerId: definition.id }))
    source.on('featuresloaderror', () =>
      this.emit('layer:error', { layerId: definition.id, error: new Error(`Layer “${definition.id}” 数据加载失败`) })
    )
  }

  private handleFeatureClick(pixel: number[], coordinate: number[]): void {
    this.map.forEachFeatureAtPixel(pixel, (featureLike, layer) => {
      if (!layer) return undefined
      const layerId = layer.get(SCENE_LAYER_ID) as string | undefined
      if (!layerId) return undefined
      const definition = this.findDefinition(layerId)
      if (
        definition?.type !== 'vector' ||
        (!definition.interaction?.selectable && !definition.interaction?.popup)
      ) {
        return undefined
      }
      const feature = featureLike as Feature<Geometry>
      this.emit('feature:click', {
        layerId,
        featureId: feature.getId() === undefined ? null : String(feature.getId()),
        feature: toGeoJsonFeature(feature, this.map.getView().getProjection().getCode()),
        coordinate: [coordinate[0] ?? 0, coordinate[1] ?? 0]
      })
      return feature
    })
  }

  private emitSelection(): void {
    const features = this.selectInteraction?.getFeatures().getArray() ?? []
    let layerId: string | null = null
    if (features[0]) {
      for (const [candidateId, layer] of this.layers) {
        if (layer instanceof VectorLayer && layer.getSource()?.hasFeature(features[0])) {
          layerId = candidateId
          break
        }
      }
    }
    this.emit('selection:change', {
      layerId,
      featureIds: features.flatMap((feature) =>
        feature.getId() === undefined ? [] : [String(feature.getId())]
      )
    })
  }

  private emit<K extends SceneRuntimeEvent>(type: K, event: SceneRuntimeEventMap[K]): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never)
  }

  private requireLayer(layerId: string): BaseLayer {
    const layer = this.layers.get(layerId)
    if (!layer) throw new Error(`Layer “${layerId}” 不存在`)
    return layer
  }

  private findDefinition(layerId: string): SceneLayer | undefined {
    return this.scene?.layers.find((layer) => layer.id === layerId)
  }

  private waitForSource(layerId: string, source: VectorSource): Promise<void> {
    if (source.getFeatures().length > 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const endKey = source.once('featuresloadend', () => {
        source.un('featuresloaderror', onError)
        resolve()
      })
      const onError = (): void => {
        unByKey(endKey)
        reject(new Error(`Layer “${layerId}” 数据加载失败`))
      }
      source.once('featuresloaderror', onError)
      source.refresh()
    })
  }
}

function sceneSourceIsInline(scene: SceneManifest | null, sourceId: string): boolean {
  const source = scene?.sources[sourceId]
  return source?.type === 'geojson' && Boolean(source.data)
}

export async function createSceneRuntime(options: CreateSceneRuntimeOptions): Promise<OlSceneRuntime> {
  const runtime = new OlSceneRuntime(options)
  try {
    if (options.scene) await runtime.loadScene(options.scene)
  } catch (error) {
    runtime.destroy()
    throw error
  }
  return runtime
}
