import { Cartesian2, Cartesian3, Cartographic, Cesium3DTileColorBlendMode, Cesium3DTileFeature, Cesium3DTileStyle, Cesium3DTileset, Color, ColorBlendMode, ColorMaterialProperty, ConstantProperty, Entity, GeoJsonDataSource, JulianDate, KeyboardEventModifier, Math as CesiumMath, Matrix4, Model, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms } from 'cesium'
import type { BoundingSphere, Resource, Viewer } from 'cesium'
import { createTransform, validateTransform } from '@desktop-webgis/cesium-scene-schema'
import type { GeoPosition, Transform } from '@desktop-webgis/cesium-scene-schema'
import { composeTransform } from './transform.js'
export { composeTransform } from './transform.js'

export { BaseLayer } from './base-layer.js'
export type { LayerOptions, LayerClickEvent } from './base-layer.js'
import { BaseLayer } from './base-layer.js'
import type { LayerClickEvent, LayerOptions } from './base-layer.js'
export { Graphic, GraphicLayer } from './graphic-layer.js'
export { DrawSession } from './draw.js'
export type { DrawOptions, DrawResult } from './draw.js'
export { EditSession } from './graphic-edit.js'
export type { EditState, GraphicEditOptions, GraphicEditResult } from './graphic-edit.js'
export { resolveGraphicLabel } from './graphic-label.js'
export { ImageryTemplateLayer } from './imagery-layer.js'
export type { ImageryTemplateLayerOptions } from './imagery-layer.js'

export interface TransformLayer {
  readonly id: string
  readonly boundingSphere: BoundingSphere | undefined
  readonly pivot: Cartesian3 | undefined
  getTransform(): Transform
  setTransform(transform: Transform): void
}

abstract class AssetLayer extends BaseLayer implements TransformLayer {
  protected highlighted = false
  protected originalMatrix?: Matrix4
  pivot: Cartesian3 | undefined
  protected transform: Transform = createTransform()
  abstract get boundingSphere(): BoundingSphere | undefined
  abstract get native(): Model | Cesium3DTileset | undefined
  protected abstract applyHighlight(value: boolean): void
  /** Transient selection feedback; restoring it never changes serialized resource options. */
  setHighlighted(value: boolean): void { this.highlighted = value; this.applyHighlight(value); this.viewer?.scene.requestRender() }
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
  private highlightTarget?: Cesium3DTileset
  private previousStyle?: Cesium3DTileStyle
  private previousBlend?: { mode: Cesium3DTileset['colorBlendMode']; amount: number }
  constructor(private readonly options: TilesetLayerOptions) { super(options); this.transform = structuredClone(options.transform ?? createTransform()) }
  get native(): Cesium3DTileset | undefined { return this.tileset }
  get boundingSphere(): BoundingSphere | undefined { return this.tileset?.boundingSphere }
  /** Update LOD and cache without reloading the asset or interrupting editing. */
  setQuality(maximumScreenSpaceError = 16, cacheBytes = 256 * 1024 * 1024): void {
    if (!this.tileset) return
    this.tileset.maximumScreenSpaceError = maximumScreenSpaceError
    this.tileset.cacheBytes = cacheBytes
    this.viewer?.scene.requestRender()
  }
  contains(picked: unknown): boolean { return picked instanceof Cesium3DTileFeature ? picked.tileset === this.tileset : isPick(picked) && (picked.primitive === this.tileset || picked.tileset === this.tileset) }
  protected async createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void> {
    const tileset = await Cesium3DTileset.fromUrl(this.options.url, { maximumScreenSpaceError: this.options.maximumScreenSpaceError ?? 16, cacheBytes: this.options.cacheBytes ?? 256 * 1024 * 1024 })
    if (signal.aborted || viewer.isDestroyed()) { tileset.destroy(); return () => {} }
    this.tileset = tileset
    this.originalMatrix = Matrix4.clone(tileset.modelMatrix)
    this.pivot = Cartesian3.clone(tileset.boundingSphere.center)
    tileset.show = this.show
    viewer.scene.primitives.add(tileset)
    this.setTransform(this.transform)
    this.setHighlighted(this.highlighted)
    const removeFailed = tileset.tileFailed.addEventListener((failure: { message: string }) => this.emit('error',new Error(failure.message)))
    return () => {
      removeFailed()
      if (this.highlightTarget === tileset) { this.highlightTarget = undefined; this.previousStyle = undefined; this.previousBlend = undefined }
      if (!viewer.isDestroyed() && !tileset.isDestroyed()) viewer.scene.primitives.remove(tileset); else if (!tileset.isDestroyed()) tileset.destroy()
      if (this.tileset === tileset) this.tileset = undefined
    }
  }
  protected applyHighlight(value: boolean): void {
    if (!this.tileset) return
    if (value) {
      if (this.highlightTarget === this.tileset) return
      this.highlightTarget = this.tileset; this.previousStyle = this.tileset.style
      this.previousBlend = { mode: this.tileset.colorBlendMode, amount: this.tileset.colorBlendAmount }
      this.tileset.colorBlendMode = Cesium3DTileColorBlendMode.MIX; this.tileset.colorBlendAmount = .2
      this.tileset.style = new Cesium3DTileStyle({ color: 'color("#3984d7", 1)' })
    } else if (this.highlightTarget === this.tileset) {
      this.tileset.style = this.previousStyle; this.highlightTarget = undefined; this.previousStyle = undefined
      if (this.previousBlend) { this.tileset.colorBlendMode = this.previousBlend.mode; this.tileset.colorBlendAmount = this.previousBlend.amount; this.previousBlend = undefined }
    }
  }
}

export interface ModelLayerOptions extends LayerOptions { url: string | Resource; position: GeoPosition; transform?: Transform }
export class ModelLayer extends AssetLayer {
  model?: Model
  private highlightTarget?: Model
  private previousColor?: { color: Color; mode: Model['colorBlendMode']; amount: number }
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
    this.setHighlighted(this.highlighted)
    model.show = this.show
    viewer.scene.primitives.add(model)
    const release = () => {
      if (this.highlightTarget === model) { this.highlightTarget = undefined; this.previousColor = undefined }
      if (!viewer.isDestroyed() && !model.isDestroyed()) viewer.scene.primitives.remove(model); else if (!model.isDestroyed()) model.destroy()
      if (this.model === model) this.model = undefined
    }
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
  protected applyHighlight(value: boolean): void {
    if (!this.model) return
    if (value) {
      if (this.highlightTarget === this.model) return
      this.highlightTarget = this.model
      this.previousColor = { color: Color.clone(this.model.color), mode: this.model.colorBlendMode, amount: this.model.colorBlendAmount }
      this.model.color = Color.fromCssColorString('#3984d7'); this.model.colorBlendMode = ColorBlendMode.MIX; this.model.colorBlendAmount = .2
    } else if (this.highlightTarget === this.model && this.previousColor) {
      this.model.color = this.previousColor.color; this.model.colorBlendMode = this.previousColor.mode; this.model.colorBlendAmount = this.previousColor.amount
      this.highlightTarget = undefined; this.previousColor = undefined
    }
  }
}

export interface GeoJsonLayerOptions extends LayerOptions { data: string | Resource | object; color?: string }
export class GeoJsonLayer extends BaseLayer {
  dataSource?: GeoJsonDataSource
  setColor(value: string): void {
    const color = Color.fromCssColorString(value)
    if (!color) throw new Error('颜色无效')
    for (const entity of this.dataSource?.entities.values ?? []) {
      if (entity.polygon) entity.polygon.material = new ColorMaterialProperty(color.withAlpha(.35))
      if (entity.polyline) entity.polyline.material = new ColorMaterialProperty(color)
      if (entity.point) entity.point.color = new ConstantProperty(color)
      if (entity.billboard) entity.billboard.color = new ConstantProperty(color)
    }
    this.viewer?.scene.requestRender()
  }
  constructor(private readonly options: GeoJsonLayerOptions) { super(options) }
  contains(picked: unknown): boolean { return isPick(picked) && picked.id instanceof Entity && Boolean(this.dataSource?.entities.contains(picked.id)) }
  async flyTo(): Promise<void> { if (this.viewer && this.dataSource) await this.viewer.flyTo(this.dataSource) }
  protected setNativeVisible(value: boolean): void { if (this.dataSource) this.dataSource.show = value }
  protected async createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void> {
    const color = Color.fromCssColorString(this.options.color ?? '#55a6ff')
    const source = await GeoJsonDataSource.load(this.options.data, { clampToGround: true, stroke: color, fill: color.withAlpha(0.35), markerColor: color })
    if (signal.aborted || viewer.isDestroyed()) return () => {}
    source.show = this.show
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
  popupsEnabled = true
  constructor(readonly viewer: Viewer) {
    this.handler = new ScreenSpaceEventHandler(viewer.canvas)
    const pick = (event: { position: Cartesian2 }, selection?: LayerClickEvent['selection']): void => {
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
      void layer.handleClick({ layer, position, properties, picked, selection }, this.popupsEnabled)
    }
    this.handler.setInputAction((event: { position: Cartesian2 }) => pick(event), ScreenSpaceEventType.LEFT_CLICK)
    this.handler.setInputAction((event: { position: Cartesian2 }) => pick(event, 'toggle'), ScreenSpaceEventType.LEFT_CLICK, KeyboardEventModifier.CTRL)
    this.handler.setInputAction((event: { position: Cartesian2 }) => pick(event, 'range'), ScreenSpaceEventType.LEFT_CLICK, KeyboardEventModifier.SHIFT)
  }
  get layers(): BaseLayer[] { return [...this.registry.values()] }
  getLayer(id: string): BaseLayer | undefined { return this.registry.get(id) }
  /** Adopt already-ready layers on this viewer; validation leaves current ownership untouched. */
  replaceMountedLayers(layers: readonly BaseLayer[]): void {
    if (this.destroyed) throw new Error('LayerCollection 已销毁')
    const ids = new Set<string>()
    for (const layer of layers) {
      if (ids.has(layer.id)) throw new Error(`重复图层 ID：${layer.id}`)
      if (!layer.isMountedOn(this.viewer)) throw new Error(`图层 ${layer.id} 未在当前 Viewer 就绪`)
      ids.add(layer.id)
    }
    const previous = this.layers
    this.registry.clear()
    layers.forEach(layer => this.registry.set(layer.id, layer))
    previous.forEach(layer => { if (!layers.includes(layer)) layer.unmount() })
    if (!this.viewer.isDestroyed()) this.viewer.scene.requestRender()
  }
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
