import { Cartesian2, Cartesian3, Cartographic, Cesium3DTileColorBlendMode, Cesium3DTileFeature, Cesium3DTileStyle, Cesium3DTileset, Color, ColorBlendMode, ColorMaterialProperty, ConstantProperty, Entity, GeoJsonDataSource, JulianDate, KeyboardEventModifier, Math as CesiumMath, Matrix4, Model, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms } from 'cesium'
import type { BoundingSphere, Resource, Viewer } from 'cesium'
import { createTransform, TILESET_RUNTIME_DEFAULTS, validateTilesetStyle, validateTransform } from '@desktop-webgis/cesium-scene-schema'
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
  style?: Record<string, unknown>
  maximumScreenSpaceError?: number
  cacheBytes?: number
  dynamicScreenSpaceError?: boolean
  dynamicScreenSpaceErrorDensity?: number
  dynamicScreenSpaceErrorFactor?: number
  skipLevelOfDetail?: boolean
}
export interface TilesetRuntimeParameters {
  maximumScreenSpaceError?: number
  cacheBytes?: number
  dynamicScreenSpaceError?: boolean
  dynamicScreenSpaceErrorDensity?: number
  dynamicScreenSpaceErrorFactor?: number
  skipLevelOfDetail?: boolean
}
export class TilesetLayer extends AssetLayer {
  tileset?: Cesium3DTileset
  private highlightTarget?: Cesium3DTileset
  private persistentStyle: Cesium3DTileStyle | undefined
  private previousPersistentStyle?: Cesium3DTileStyle
  private pendingStyleSource?: Record<string, unknown>
  private tileLoadCleanup?: () => void
  private highlightStyle?: Cesium3DTileStyle
  private previousBlend?: { mode: Cesium3DTileset['colorBlendMode']; amount: number }
  constructor(private readonly options: TilesetLayerOptions) { super(options); this.transform = structuredClone(options.transform ?? createTransform()) }
  get native(): Cesium3DTileset | undefined { return this.tileset }
  get boundingSphere(): BoundingSphere | undefined { return this.tileset?.boundingSphere }
  /** Read actual engine values without mixing diagnostics into persisted node options. */
  getPresentation() {
    const tileset = this.tileset
    if (!tileset) return undefined
    return {
      maximumScreenSpaceError: tileset.maximumScreenSpaceError, cacheBytes: tileset.cacheBytes,
      dynamicScreenSpaceError: tileset.dynamicScreenSpaceError, dynamicScreenSpaceErrorDensity: tileset.dynamicScreenSpaceErrorDensity,
      dynamicScreenSpaceErrorFactor: tileset.dynamicScreenSpaceErrorFactor, skipLevelOfDetail: tileset.skipLevelOfDetail,
      totalMemoryUsageInBytes: tileset.totalMemoryUsageInBytes, tilesLoaded: tileset.tilesLoaded,
      highlighted: this.highlighted,
      style: this.persistentStyle ? structuredClone(this.persistentStyle.style) : undefined,
      nativeStyle: tileset.style ? structuredClone(tileset.style.style) : undefined
    }
  }
  trimLoadedTiles(): void { this.tileset?.trimLoadedTiles(); this.viewer?.scene.requestRender() }
  /** Update LOD and cache without reloading the asset or interrupting editing. */
  setQuality(maximumScreenSpaceError: number = TILESET_RUNTIME_DEFAULTS.maximumScreenSpaceError, cacheBytes: number = TILESET_RUNTIME_DEFAULTS.cacheBytes): void {
    if (!this.tileset) return
    this.tileset.maximumScreenSpaceError = maximumScreenSpaceError
    this.tileset.cacheBytes = cacheBytes
    this.viewer?.scene.requestRender()
  }
  /** Applies the explicitly supported writable Cesium properties without generic key assignment. */
  setRuntimeParameters(parameters: TilesetRuntimeParameters): void {
    const tileset = this.tileset
    if (!tileset) return
    if (parameters.maximumScreenSpaceError !== undefined) tileset.maximumScreenSpaceError = parameters.maximumScreenSpaceError
    if (parameters.cacheBytes !== undefined) tileset.cacheBytes = parameters.cacheBytes
    tileset.dynamicScreenSpaceError = parameters.dynamicScreenSpaceError ?? TILESET_RUNTIME_DEFAULTS.dynamicScreenSpaceError
    tileset.dynamicScreenSpaceErrorDensity = parameters.dynamicScreenSpaceErrorDensity ?? TILESET_RUNTIME_DEFAULTS.dynamicScreenSpaceErrorDensity
    tileset.dynamicScreenSpaceErrorFactor = parameters.dynamicScreenSpaceErrorFactor ?? TILESET_RUNTIME_DEFAULTS.dynamicScreenSpaceErrorFactor
    tileset.skipLevelOfDetail = parameters.skipLevelOfDetail ?? TILESET_RUNTIME_DEFAULTS.skipLevelOfDetail
    this.viewer?.scene.requestRender()
  }
  /** Checks a native style against every feature currently loaded by the tileset. */
  validateStyle(style?: unknown): void {
    if (style !== undefined && !validateTilesetStyle(style)) throw new Error('3D Tiles Style 必须是可序列化 JSON 对象')
    const candidate = style === undefined ? undefined : new Cesium3DTileStyle(structuredClone(style) as ConstructorParameters<typeof Cesium3DTileStyle>[0])
    if (candidate && this.tileset && !validateTilesetStyleFeatures(candidate, this.tileset.root)) throw new Error('3D Tiles Style 无法应用于当前已加载要素')
  }
  private watchTileLoads(tileset: Cesium3DTileset): void {
    if (this.tileLoadCleanup || !tileset.tileLoad?.addEventListener) return
    this.tileLoadCleanup = tileset.tileLoad.addEventListener((tile: { content?: unknown }) => {
      const style = this.persistentStyle
      if (!style || !this.pendingStyleSource || !tile.content) return
      if (tileset.style !== style && tileset.style !== this.highlightStyle) return
      if (validateTilesetStyleFeatures(style, tile.content)) return
      const previous = this.previousPersistentStyle
      const fallback = previous && validateTilesetStyleFeatures(previous, tile.content) && validateTilesetStyleFeatures(previous, tileset.root) ? previous : undefined
      this.persistentStyle = fallback
      this.pendingStyleSource = fallback ? structuredClone(fallback.style) : undefined
      tileset.style = tileset.style === this.highlightStyle ? this.highlightStyle : fallback
      this.emit('error', new Error(`新加载的 3D Tiles 要素不满足当前 Style；${fallback ? '已恢复上一有效样式' : '已恢复无样式状态'}`))
    })
  }
  /** Applies a native style only after preflighting currently loaded features. */
  setStyle(style?: unknown): void {
    if (style !== undefined && !validateTilesetStyle(style)) throw new Error('3D Tiles Style 必须是可序列化 JSON 对象')
    if (JSON.stringify(style) === JSON.stringify(this.pendingStyleSource)) return
    this.validateStyle(style)
    const candidate = style === undefined ? undefined : new Cesium3DTileStyle(structuredClone(style) as ConstructorParameters<typeof Cesium3DTileStyle>[0])
    const tileset = this.tileset
    if (tileset) {
      this.watchTileLoads(tileset)
      const previous = tileset.style
      try {
        tileset.style = candidate
        if (this.highlightTarget === tileset) tileset.style = this.highlightStyle
      }
      catch (error) {
        if (tileset.style !== previous) tileset.style = previous
        throw new Error('应用 3D Tiles Style 失败', { cause: error })
      }
    }
    this.previousPersistentStyle = this.persistentStyle
    this.persistentStyle = candidate
    this.pendingStyleSource = style === undefined ? undefined : structuredClone(style) as Record<string, unknown>
    this.viewer?.scene.requestRender()
  }
  contains(picked: unknown): boolean { return picked instanceof Cesium3DTileFeature ? picked.tileset === this.tileset : isPick(picked) && (picked.primitive === this.tileset || picked.tileset === this.tileset) }
  protected async createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void> {
    // Parse native expressions before allocating a tileset candidate.
    this.validateStyle(this.options.style)
    const candidateStyle = this.options.style === undefined ? undefined : new Cesium3DTileStyle(structuredClone(this.options.style) as ConstructorParameters<typeof Cesium3DTileStyle>[0])
    const tileset = await Cesium3DTileset.fromUrl(this.options.url, {
      maximumScreenSpaceError: this.options.maximumScreenSpaceError ?? TILESET_RUNTIME_DEFAULTS.maximumScreenSpaceError,
      cacheBytes: this.options.cacheBytes ?? TILESET_RUNTIME_DEFAULTS.cacheBytes,
      dynamicScreenSpaceError: this.options.dynamicScreenSpaceError,
      dynamicScreenSpaceErrorDensity: this.options.dynamicScreenSpaceErrorDensity,
      dynamicScreenSpaceErrorFactor: this.options.dynamicScreenSpaceErrorFactor,
      skipLevelOfDetail: this.options.skipLevelOfDetail
    })
    if (signal.aborted || viewer.isDestroyed()) { tileset.destroy(); return () => {} }
    this.tileset = tileset
    this.persistentStyle = candidateStyle ?? tileset.style
    this.pendingStyleSource = this.options.style === undefined ? undefined : structuredClone(this.options.style)
    if (candidateStyle && !validateTilesetStyleFeatures(candidateStyle, tileset.root)) {
      tileset.destroy()
      this.tileset = undefined
      throw new Error('3D Tiles Style 无法应用于当前已加载要素')
    }
    if (this.options.style) tileset.style = this.persistentStyle
    this.originalMatrix = Matrix4.clone(tileset.modelMatrix)
    this.pivot = Cartesian3.clone(tileset.boundingSphere.center)
    tileset.show = this.show
    this.watchTileLoads(tileset)
    viewer.scene.primitives.add(tileset)
    this.setTransform(this.transform)
    this.setHighlighted(this.highlighted)
    const removeFailed = tileset.tileFailed.addEventListener((failure: { message: string }) => this.emit('error',new Error(failure.message)))
    return () => {
      this.tileLoadCleanup?.()
      this.tileLoadCleanup = undefined
      removeFailed()
      if (this.highlightTarget === tileset) { this.highlightTarget = undefined; this.highlightStyle = undefined; this.previousBlend = undefined }
      if (!viewer.isDestroyed() && !tileset.isDestroyed()) viewer.scene.primitives.remove(tileset); else if (!tileset.isDestroyed()) tileset.destroy()
      if (this.tileset === tileset) this.tileset = undefined
    }
  }
  protected applyHighlight(value: boolean): void {
    if (!this.tileset) return
    if (value) {
      if (this.highlightTarget === this.tileset) return
      this.highlightTarget = this.tileset; this.persistentStyle = this.tileset.style
      this.previousBlend = { mode: this.tileset.colorBlendMode, amount: this.tileset.colorBlendAmount }
      this.tileset.colorBlendMode = Cesium3DTileColorBlendMode.MIX; this.tileset.colorBlendAmount = .2
      this.highlightStyle = new Cesium3DTileStyle({ color: 'color("#3984d7", 1)' })
      this.tileset.style = this.highlightStyle
    } else if (this.highlightTarget === this.tileset) {
      this.tileset.style = this.persistentStyle; this.highlightTarget = undefined; this.highlightStyle = undefined
      if (this.previousBlend) { this.tileset.colorBlendMode = this.previousBlend.mode; this.tileset.colorBlendAmount = this.previousBlend.amount; this.previousBlend = undefined }
    }
  }
}

function validateTilesetStyleFeatures(style: Cesium3DTileStyle, source: unknown): boolean {
  const expressions = [style.show, style.color, style.pointSize, style.pointOutlineColor, style.pointOutlineWidth, style.labelColor, style.labelOutlineColor, style.labelOutlineWidth, style.labelText, style.backgroundColor, style.backgroundPadding, style.backgroundEnabled]
    .filter((value): value is NonNullable<typeof value> => Boolean(value && typeof value === 'object'))
  const inspectContent = (content: unknown, seen: Set<unknown>): boolean => {
    if (!content || typeof content !== 'object' || seen.has(content)) return true
    seen.add(content)
    const candidate = content as { innerContents?: unknown[]; featuresLength?: number; getFeature?: (index: number) => unknown }
    if (Array.isArray(candidate.innerContents)) return candidate.innerContents.every(inner => inspectContent(inner, seen))
    if (typeof candidate.featuresLength !== 'number' || typeof candidate.getFeature !== 'function') return true
    // Unbatched GLB content still evaluates style once, with no feature metadata.
    for (let index = 0; index < Math.max(1, candidate.featuresLength); index++) {
      try {
        const feature = (candidate.featuresLength ? candidate.getFeature(index) : undefined) as Parameters<NonNullable<typeof style.show>['evaluate']>[0]
        for (const expression of expressions) {
          if (expression.evaluate) expression.evaluate(feature)
          else expression.evaluateColor?.(feature)
        }
      } catch { return false }
    }
    return true
  }
  const walkTile = (tile: unknown, seen: Set<unknown>): boolean => {
    if (!tile || typeof tile !== 'object' || seen.has(tile)) return true
    seen.add(tile)
    const candidate = tile as { content?: unknown; children?: unknown[] }
    return inspectContent(candidate.content, new Set()) && (candidate.children ?? []).every(child => walkTile(child, seen))
  }
  if (source && typeof source === 'object' && 'children' in source) return walkTile(source, new Set())
  return inspectContent(source, new Set())
}

export interface ModelLayerOptions extends LayerOptions { url: string | Resource; position: GeoPosition; transform?: Transform }
export class ModelLayer extends AssetLayer {
  model?: Model
  private highlightTarget?: Model
  private previousColor?: { color: Color; mode: Model['colorBlendMode']; amount: number }
  constructor(private readonly options: ModelLayerOptions) { super(options); this.transform = structuredClone(options.transform ?? createTransform()) }
  get native(): Model | undefined { return this.model }
  get boundingSphere(): BoundingSphere | undefined { return this.model?.ready ? this.model.boundingSphere : undefined }
  /** Reposition an installed model using its public modelMatrix, retaining its transform. */
  setPosition(position: GeoPosition): void {
    if (!position.every(Number.isFinite) || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) throw new Error('模型地理位置无效')
    this.options.position = [...position]
    this.pivot = Cartesian3.fromDegrees(...position)
    this.originalMatrix = Transforms.eastNorthUpToFixedFrame(this.pivot)
    this.setTransform(this.transform)
  }
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
