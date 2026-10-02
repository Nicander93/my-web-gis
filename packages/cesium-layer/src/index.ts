import { Cartesian2, Cartesian3, Cartographic, Cesium3DTileFeature, Cesium3DTileset, Color, Entity, GeoJsonDataSource, JulianDate, Math as CesiumMath, Matrix4, Model, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms } from 'cesium'
import type { BoundingSphere, Resource, Viewer } from 'cesium'
import { Popup } from '@desktop-webgis/cesium-popup'
import type { PopupContent } from '@desktop-webgis/cesium-popup'
import { createTransform, validateTransform } from '@desktop-webgis/cesium-scene-schema'
import type { GeoPosition, Transform } from '@desktop-webgis/cesium-scene-schema'
import { composeTransform } from './transform.js'
export { composeTransform } from './transform.js'

export interface LayerOptions { id: string; name?: string; show?: boolean }
export interface LayerClickEvent { layer: BaseLayer; position: Cartesian3; properties: Record<string, unknown>; picked: unknown }
interface LayerEvents { click: LayerClickEvent; load: BaseLayer; error: Error }

/** An explicit lifecycle for framework-independent Cesium layers. */
export abstract class BaseLayer {
  readonly id: string
  readonly name: string
  protected viewer?: Viewer
  private visible: boolean
  private popupContent?: PopupContent
  private popup?: Popup
  private revision = 0
  private abort?: AbortController
  private destroyed = false
  private listeners: { [K in keyof LayerEvents]?: Set<(event: LayerEvents[K]) => void> } = {}
  state: 'idle' | 'loading' | 'ready' | 'error' = 'idle'

  constructor(options: LayerOptions) {
    this.id = options.id
    this.name = options.name ?? options.id
    this.visible = options.show ?? true
  }
  get show(): boolean { return this.visible }
  set show(value: boolean) { this.visible = value; this.setNativeVisible(value); if (!value) this.popup?.close(); this.viewer?.scene.requestRender() }
  bindPopup(content: PopupContent): this { this.popupContent = content; return this }
  unbindPopup(): this { this.popupContent = undefined; this.popup?.destroy(); this.popup = undefined; return this }
  closePopup(): void { this.popup?.close() }
  on<K extends keyof LayerEvents>(type: K, listener: (event: LayerEvents[K]) => void): () => void {
    const set = this.listeners[type] as Set<(event: LayerEvents[K]) => void> | undefined
    const listeners = set ?? new Set<(event: LayerEvents[K]) => void>()
    if (!set) Object.assign(this.listeners, { [type]: listeners })
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  protected emit<K extends keyof LayerEvents>(type: K, event: LayerEvents[K]): void {
    const listeners = this.listeners[type] as Set<(event: LayerEvents[K]) => void> | undefined
    listeners?.forEach(listener => listener(event))
  }
  async addTo(collection: LayerCollection): Promise<this> { await collection.addLayer(this); return this }
  async mount(viewer: Viewer): Promise<void> {
    if (this.destroyed) throw new Error(`图层 ${this.id} 已销毁`)
    if (this.viewer) throw new Error(`图层 ${this.id} 已挂载`)
    this.viewer = viewer
    const revision = ++this.revision
    this.abort = new AbortController()
    this.state = 'loading'
    try {
      const release = await this.createNative(viewer, this.abort.signal)
      if (revision !== this.revision) { release(); return }
      this.releaseNative = release
      this.state = 'ready'
      this.setNativeVisible(this.visible)
      this.emit('load', this)
      viewer.scene.requestRender()
    } catch (cause) {
      if (revision !== this.revision) return
      this.viewer = undefined
      this.state = 'error'
      const error = cause instanceof Error ? cause : new Error(String(cause))
      this.emit('error', error)
      throw error
    }
  }
  private releaseNative?: () => void
  unmount(): void {
    this.revision++
    this.abort?.abort(); this.abort = undefined
    this.popup?.destroy(); this.popup = undefined
    this.releaseNative?.(); this.releaseNative = undefined
    this.viewer = undefined
    this.state = 'idle'
  }
  destroy(): void { if (this.destroyed) return; this.unmount(); this.destroyed = true; this.listeners = {} }
  async handleClick(event: LayerClickEvent): Promise<void> {
    this.emit('click', event)
    if (!this.popupContent || !this.viewer || !this.show) return
    this.popup ??= new Popup(this.viewer)
    try { await this.popup.open({ position: event.position, properties: event.properties, title: this.name }, this.popupContent) }
    catch (cause) { this.emit('error', cause instanceof Error ? cause : new Error(String(cause))) }
  }
  abstract contains(picked: unknown): boolean
  abstract flyTo(): Promise<void>
  protected abstract createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void>
  protected abstract setNativeVisible(value: boolean): void
}

export interface TransformLayer {
  readonly id: string
  readonly boundingSphere: BoundingSphere | undefined
  readonly pivot: Cartesian3 | undefined
  getTransform(): Transform
  setTransform(transform: Transform): void
}

abstract class AssetLayer extends BaseLayer implements TransformLayer {
  protected originalMatrix?: Matrix4
  pivot: Cartesian3 | undefined
  protected transform: Transform = createTransform()
  abstract get boundingSphere(): BoundingSphere | undefined
  abstract get native(): Model | Cesium3DTileset | undefined
  getTransform(): Transform { return structuredClone(this.transform) }
  setTransform(transform: Transform): void {
    if (!validateTransform(transform)) throw new Error('变换参数无效')
    if (!this.originalMatrix || !this.pivot || !this.native) { this.transform = structuredClone(transform); return }
    this.native.modelMatrix = composeTransform(this.originalMatrix, this.pivot, transform)
    this.transform = structuredClone(transform)
    this.viewer?.scene.requestRender()
  }
  async flyTo(): Promise<void> {
    if (!this.viewer || !this.boundingSphere) return
    this.viewer.camera.flyToBoundingSphere(this.boundingSphere)
  }
  protected setNativeVisible(value: boolean): void { if (this.native) this.native.show = value }
}

export interface TilesetLayerOptions extends LayerOptions {
  url: string | Resource
  transform?: Transform
  maximumScreenSpaceError?: number
  cacheBytes?: number
}
export class TilesetLayer extends AssetLayer {
  tileset?: Cesium3DTileset
  constructor(private readonly options: TilesetLayerOptions) { super(options); this.transform = structuredClone(options.transform ?? createTransform()) }
  get native(): Cesium3DTileset | undefined { return this.tileset }
  get boundingSphere(): BoundingSphere | undefined { return this.tileset?.boundingSphere }
  contains(picked: unknown): boolean { return picked instanceof Cesium3DTileFeature ? picked.tileset === this.tileset : isPick(picked) && (picked.primitive === this.tileset || picked.tileset === this.tileset) }
  protected async createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void> {
    const tileset = await Cesium3DTileset.fromUrl(this.options.url, { maximumScreenSpaceError: this.options.maximumScreenSpaceError ?? 16, cacheBytes: this.options.cacheBytes ?? 256 * 1024 * 1024 })
    if (signal.aborted || viewer.isDestroyed()) { tileset.destroy(); return () => {} }
    this.tileset = tileset
    this.originalMatrix = Matrix4.clone(tileset.modelMatrix)
    this.pivot = Cartesian3.clone(tileset.boundingSphere.center)
    viewer.scene.primitives.add(tileset)
    this.setTransform(this.transform)
    const removeFailed = tileset.tileFailed.addEventListener((failure: { message: string }) => this.emit('error',new Error(failure.message)))
    return () => { removeFailed(); if (!viewer.isDestroyed() && !tileset.isDestroyed()) viewer.scene.primitives.remove(tileset); else if (!tileset.isDestroyed()) tileset.destroy(); if (this.tileset === tileset) this.tileset = undefined }
  }
}

export interface ModelLayerOptions extends LayerOptions { url: string | Resource; position: GeoPosition; transform?: Transform }
export class ModelLayer extends AssetLayer {
  model?: Model
  constructor(private readonly options: ModelLayerOptions) { super(options); this.transform = structuredClone(options.transform ?? createTransform()) }
  get native(): Model | undefined { return this.model }
  get boundingSphere(): BoundingSphere | undefined { return this.model?.ready ? this.model.boundingSphere : undefined }
  contains(picked: unknown): boolean { return isPick(picked) && (picked.primitive === this.model || picked.id === this.id) }
  protected async createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void> {
    const pivot = Cartesian3.fromDegrees(...this.options.position)
    const base = Transforms.eastNorthUpToFixedFrame(pivot)
    const model = await Model.fromGltfAsync({ url: this.options.url, modelMatrix: composeTransform(base, pivot, this.transform), id: this.id })
    if (signal.aborted || viewer.isDestroyed()) { model.destroy(); return () => {} }
    this.model = model; this.originalMatrix = base; this.pivot = pivot
    viewer.scene.primitives.add(model)
    const release = () => { if (!viewer.isDestroyed() && !model.isDestroyed()) viewer.scene.primitives.remove(model); else if (!model.isDestroyed()) model.destroy(); if (this.model === model) this.model = undefined }
    viewer.scene.requestRender()
    if (!model.ready) {
      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { removeReady(); removeError(); signal.removeEventListener('abort', abort) }
          const abort = () => { cleanup(); reject(new Error('模型加载已取消')) }
          const removeReady = model.readyEvent.addEventListener(() => { cleanup(); resolve() })
          const removeError = model.errorEvent.addEventListener((error: Error) => { cleanup(); reject(error) })
          signal.addEventListener('abort', abort, { once: true })
        })
      } catch (error) { release(); throw error }
    }
    return release
  }
}

export interface GeoJsonLayerOptions extends LayerOptions { data: string | Resource | object; color?: string }
export class GeoJsonLayer extends BaseLayer {
  dataSource?: GeoJsonDataSource
  constructor(private readonly options: GeoJsonLayerOptions) { super(options) }
  contains(picked: unknown): boolean { return isPick(picked) && picked.id instanceof Entity && Boolean(this.dataSource?.entities.contains(picked.id)) }
  async flyTo(): Promise<void> { if (this.viewer && this.dataSource) await this.viewer.flyTo(this.dataSource) }
  protected setNativeVisible(value: boolean): void { if (this.dataSource) this.dataSource.show = value }
  protected async createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void> {
    const color = Color.fromCssColorString(this.options.color ?? '#55a6ff')
    const source = await GeoJsonDataSource.load(this.options.data, { clampToGround: true, stroke: color, fill: color.withAlpha(0.35), markerColor: color })
    if (signal.aborted || viewer.isDestroyed()) return () => {}
    await viewer.dataSources.add(source)
    if (signal.aborted || viewer.isDestroyed()) { if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true); return () => {} }
    this.dataSource = source
    return () => { if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true); if (this.dataSource === source) this.dataSource = undefined }
  }
}

function isPick(value: unknown): value is { primitive?: unknown; id?: unknown; tileset?: unknown } { return value !== null && typeof value === 'object' }

/** Owns layer IDs and a single pick handler; the caller retains Viewer ownership. */
export class LayerCollection {
  private readonly registry = new Map<string, BaseLayer>()
  private readonly handler: ScreenSpaceEventHandler
  private destroyed = false
  pickingEnabled = true
  constructor(readonly viewer: Viewer) {
    this.handler = new ScreenSpaceEventHandler(viewer.canvas)
    this.handler.setInputAction((event: { position: Cartesian2 }) => {
      if (!this.pickingEnabled) return
      const picked: unknown = viewer.scene.pick(event.position)
      const layer = this.layers.find(candidate => candidate.show && candidate.contains(picked))
      this.layers.forEach(candidate => candidate.closePopup())
      if (!layer) return
      let position: Cartesian3 | undefined
      if (viewer.scene.pickPositionSupported) position = viewer.scene.pickPosition(event.position)
      position ??= viewer.camera.pickEllipsoid(event.position)
      if (!position) return
      const properties: Record<string, unknown> = {}
      if (picked instanceof Cesium3DTileFeature) for (const name of picked.getPropertyIds()) properties[name] = picked.getProperty(name)
      else if (isPick(picked) && picked.id && typeof picked.id === 'object' && 'properties' in picked.id) {
        const bag = picked.id.properties as { getValue(time: JulianDate): Record<string, unknown> } | undefined
        Object.assign(properties, bag?.getValue(viewer.clock.currentTime))
      }
      void layer.handleClick({ layer, position, properties, picked })
    }, ScreenSpaceEventType.LEFT_CLICK)
  }
  get layers(): BaseLayer[] { return [...this.registry.values()] }
  getLayer(id: string): BaseLayer | undefined { return this.registry.get(id) }
  async addLayer<T extends BaseLayer>(layer: T): Promise<T> {
    if (this.destroyed) throw new Error('LayerCollection 已销毁')
    if (this.registry.has(layer.id)) throw new Error(`重复图层 ID：${layer.id}`)
    this.registry.set(layer.id, layer)
    try { await layer.mount(this.viewer); return layer }
    catch (error) { if (this.registry.get(layer.id) === layer) this.registry.delete(layer.id); layer.unmount(); throw error }
  }
  removeLayer(id: string): void { const layer = this.registry.get(id); if (!layer) return; this.registry.delete(id); layer.unmount(); if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender() }
  destroy(): void { if (this.destroyed) return; this.destroyed = true; this.handler.destroy(); this.layers.forEach(layer => layer.destroy()); this.registry.clear() }
}

export function toGeoPosition(cartesian: Cartesian3): GeoPosition {
  const p = Cartographic.fromCartesian(cartesian)
  return [CesiumMath.toDegrees(p.longitude), CesiumMath.toDegrees(p.latitude), p.height]
}
