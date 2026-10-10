import { Cartesian3, CesiumTerrainProvider, EllipsoidTerrainProvider, ImageryLayer, JulianDate, Math as CesiumMath, Resource, TileMapServiceImageryProvider, UrlTemplateImageryProvider, Viewer, buildModuleUrl } from 'cesium'
import { BaseLayer, DrawSession, GeoJsonLayer, GraphicLayer, ImageryTemplateLayer, LayerCollection, ModelLayer, TilesetLayer } from '@desktop-webgis/cesium-layer'
import type { DrawOptions, EditSession, GraphicEditOptions } from '@desktop-webgis/cesium-layer'
import { TilesetEditor } from '@desktop-webgis/cesium-tileset-edit'
import type { EditMode, TransformEditEvent } from '@desktop-webgis/cesium-tileset-edit'
import { CityEffects, WaterLayer } from '@desktop-webgis/cesium-effects'
import { getCityNodeState, parseCityScene } from '@desktop-webgis/cesium-scene-schema'
import type { CityCamera, CityNode, CityScene } from '@desktop-webgis/cesium-scene-schema'
import { applyRenderQuality, defaultRenderQuality } from './render-quality.js'
import type { RenderQuality } from './render-quality.js'
import { projectCesiumDocument, type CesiumDocumentIssue } from './document.js'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import type { ImageryProvider, TerrainProvider } from 'cesium'
export { defaultRenderQuality, isRenderQuality } from './render-quality.js'
export type { RenderQuality } from './render-quality.js'
export type { EditMode, TransformEditEvent } from '@desktop-webgis/cesium-tileset-edit'
export type { CityScene, CityNode, Transform } from '@desktop-webgis/cesium-scene-schema'
export type { DrawOptions, DrawResult } from '@desktop-webgis/cesium-layer'
export type { EditState, GraphicEditOptions, GraphicEditResult } from '@desktop-webgis/cesium-layer'
export * from './document.js'

export interface CityRuntimeOptions {
  target?: HTMLElement | string
  /** Existing viewer is caller-owned unless ownsViewer is explicitly true. */
  viewer?: Viewer
  scene: CityScene
  /** Direct constructor defaults to owning the viewer for compatibility. */
  ownsViewer?: boolean
  /** Base URL of scene.json; resolves relative asset and terrain URLs. */
  sceneUrl?: string
  cesiumBaseUrl?: string
  renderQuality?: RenderQuality
  /** Inject credentials at runtime rather than storing tokens in scene URLs. */
  resolveResource?: (url: string) => Resource
  onEdit?: (event: TransformEditEvent) => void
  onSelect?: (id: string | null, properties?: Record<string, unknown>, selection?: 'toggle' | 'range') => void
  onLayerState?: (id: string, state: BaseLayer['state'], error?: Error) => void
}

interface PreparedEnvironment { key: string; imagery: ImageryProvider; terrain: TerrainProvider }

/** Composes independent packages; editing and read-only viewers share this renderer. */
export class CitySceneRuntime {
  readonly layers: LayerCollection
  private readonly editor: TilesetEditor
  private readonly effects: CityEffects
  private readonly nodes = new Map<string, CityNode>()
  private readonly nativeKeys = new Map<string, string>()
  private scene: CityScene
  private editingId?: string
  private drawing?: DrawSession
  private graphicEditing?: EditSession
  private selectedIds: readonly string[] = []
  private destroyed = false
  private preparation: AbortController | null = null
  private sceneRevision = 0
  private readonly layerReady = new Map<BaseLayer, Promise<unknown>>()
  private readonly currentLayers = new Map<string, BaseLayer>()
  private baseLayer?: ImageryLayer
  private environmentRevision = 0
  private environmentKey = ''
  private lightingKey = ''
  private readonly originalLighting: { sunlight: boolean; shadows: boolean; time: JulianDate }
  private readonly originalTerrain: Viewer['terrainProvider']

  constructor(readonly viewer: Viewer, private readonly options: CityRuntimeOptions) {
    this.scene = parseCityScene(options.scene)
    this.originalTerrain = viewer.terrainProvider
    this.originalLighting = { sunlight: viewer.scene.globe?.enableLighting ?? false, shadows: viewer.shadows ?? false, time: JulianDate.clone(viewer.clock?.currentTime ?? JulianDate.now()) }
    this.layers = new LayerCollection(viewer)
    this.effects = new CityEffects(viewer)
    this.editor = new TilesetEditor(viewer, {
      translationSnap: 0,
      onStart: () => { this.layers.pickingEnabled = false; this.layers.layers.forEach(l => l.closePopup()) },
      onCommit: event => { this.layers.pickingEnabled = true; this.options.onEdit?.(event) },
      onCancel: () => { this.layers.pickingEnabled = true }
    })
  }

  async updateScene(input: CityScene): Promise<void> {
    if (this.destroyed) throw new Error('CitySceneRuntime 已销毁')
    const scene = parseCityScene(input)
    this.cancelPreparation()
    const revision = ++this.sceneRevision
    // Cancel an in-flight gesture before applying authoritative state (undo/import/hide).
    this.cancelDraw(); this.cancelGraphicEditing(); this.editor.cancel()
    this.scene = scene
    this.effects.update(scene.effects)
    const lightingKey = JSON.stringify(scene.lighting ?? null)
    if (lightingKey !== this.lightingKey) {
      if (this.viewer.scene.globe) this.viewer.scene.globe.enableLighting = scene.lighting?.sunlight ?? this.originalLighting.sunlight
      this.viewer.shadows = scene.lighting?.shadows ?? this.originalLighting.shadows
      if (this.viewer.clock) this.viewer.clock.currentTime = scene.lighting ? JulianDate.fromIso8601(scene.lighting.time) : JulianDate.clone(this.originalLighting.time)
      this.lightingKey = lightingKey; this.viewer.scene.requestRender()
    }
    const promises: Promise<unknown>[] = []
    for (const id of this.nodes.keys()) {
      if (scene.nodes.some(node => node.id === id)) continue
      if (this.editingId === id) this.stopEditing()
      this.layers.removeLayer(id); this.nodes.delete(id); this.nativeKeys.delete(id); this.currentLayers.delete(id)
    }
    for (const definition of scene.nodes) {
      const node = { ...definition, ...getCityNodeState(scene, definition) }
      const previous = this.nodes.get(node.id)
      let layer = this.layers.getLayer(node.id)
      if (layer && previous && (layer.state === 'error' || this.nativeKeys.get(node.id) !== nativeKey(node, scene))) {
        if (this.editingId === node.id) this.stopEditing()
        this.layers.removeLayer(node.id); layer = undefined
      }
      this.nodes.set(node.id, structuredClone(node))
      this.nativeKeys.set(node.id, nativeKey(node, scene))
      if (layer) {
        const ready = this.layerReady.get(layer)
        if (ready) promises.push(ready)
        layer.name = node.name
        if ((!node.visible || node.locked) && this.editingId === node.id) this.stopEditing()
        layer.show = node.visible
        if ((layer instanceof TilesetLayer || layer instanceof ModelLayer) && (node.type === '3dtiles' || node.type === 'model')) layer.setTransform(node.transform)
        if (layer instanceof TilesetLayer && node.type === '3dtiles') layer.setQuality(node.maximumScreenSpaceError, node.cacheBytes)
        if (layer instanceof GraphicLayer && node.type === 'graphic') layer.getGraphic(node.id)?.setOptions(node)
        if (layer instanceof GeoJsonLayer && node.type === 'geojson') layer.setColor(node.color ?? '#55a6ff')
        if (layer instanceof ImageryTemplateLayer && node.type === 'imagery' && node.opacity !== undefined) layer.setOpacity(node.opacity)
        this.applySelection(layer)
        if (node.popup) layer.bindPopup(node.popup); else layer.unbindPopup()
        continue
      }
      layer = this.createLayer(node, scene)
      if (node.popup) layer.bindPopup(node.popup)
      const mounted = layer
      this.currentLayers.set(node.id, mounted)
      mounted.on('click', event => this.options.onSelect?.(node.id, event.properties, event.selection))
      mounted.on('error', error => {
        if (!this.destroyed && this.currentLayers.get(node.id) === mounted) this.options.onLayerState?.(node.id, 'error', error)
      })
      const pending = this.layers.addLayer(mounted).then(() => {
        if (this.destroyed || this.layers.getLayer(node.id) !== mounted) return
        const latest = this.nodes.get(node.id)
        if (latest && (latest.type === '3dtiles' || latest.type === 'model') && (mounted instanceof TilesetLayer || mounted instanceof ModelLayer)) mounted.setTransform(latest.transform)
        if (latest?.type === '3dtiles' && mounted instanceof TilesetLayer) mounted.setQuality(latest.maximumScreenSpaceError, latest.cacheBytes)
        if (latest?.type === 'geojson' && mounted instanceof GeoJsonLayer) mounted.setColor(latest.color ?? '#55a6ff')
        this.applySelection(mounted)
        this.options.onLayerState?.(node.id, mounted.state)
      }).catch(error => {
        if (this.destroyed || this.currentLayers.get(node.id) !== mounted) return
        throw error
      })
      this.layerReady.set(mounted, pending)
      void pending.then(() => this.layerReady.delete(mounted), () => this.layerReady.delete(mounted))
      this.options.onLayerState?.(node.id, 'loading')
      promises.push(pending)
    }
    this.editor.refresh()
    promises.push(this.updateEnvironment(scene))
    const results = await Promise.allSettled(promises)
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length && !this.destroyed && revision === this.sceneRevision) throw new Error(failures.map(f => f.reason instanceof Error ? f.reason.message : String(f.reason)).join('\n'))
  }

  /** Load hidden candidates before replacing owned content; failed preparation preserves the current scene. */
  async replaceScene(input: CityScene, signal?: AbortSignal, options: { preserveCamera?: boolean } = {}): Promise<void> {
    if (this.destroyed) throw new Error('CitySceneRuntime 已销毁')
    const scene = parseCityScene(input)
    this.cancelPreparation()
    const operation = new AbortController()
    this.preparation = operation
    const prepared = new Map<string, BaseLayer>()
    const definitions = new Map(scene.nodes.map(node => [node.id, { ...node, ...getCityNodeState(scene, node) }]))
    let committed = false, committing = false
    const abort = (): void => operation.abort(signal?.reason)
    const release = (): void => { if (!committed && !committing) prepared.forEach(layer => layer.destroy()) }
    let rejectCancellation!: (reason: unknown) => void
    const canceled = new Promise<never>((_resolve, reject) => { rejectCancellation = reject })
    const rejectAborted = (): void => rejectCancellation(operation.signal.reason)
    // Observe cancellation even when a native provider ignores its own abort signal.
    void canceled.catch(() => {})
    signal?.addEventListener('abort', abort, { once: true })
    operation.signal.addEventListener('abort', release, { once: true })
    operation.signal.addEventListener('abort', rejectAborted, { once: true })
    if (signal?.aborted) abort()
    try {
      operation.signal.throwIfAborted()
      for (const node of definitions.values()) {
        operation.signal.throwIfAborted()
        const layer = this.createLayer(node, scene)
        layer.show = false
        if (node.popup) layer.bindPopup(node.popup)
        prepared.set(node.id, layer)
      }
      operation.signal.throwIfAborted()
      const loads = [...prepared.values()].map(layer => layer.mount(this.viewer))
      // Prepare even an equal environment: a pending legacy update may still change the installed one.
      const environment = this.prepareEnvironment(scene)
      const [nextEnvironment] = await Promise.race([Promise.all([environment, ...loads]), canceled])
      operation.signal.throwIfAborted()
      if (this.destroyed || this.viewer.isDestroyed()) throw new Error('CitySceneRuntime 已销毁')
      const custom = this.layers.layers.filter(layer => !this.nodes.has(layer.id))
      const previousManaged = this.layers.layers.filter(layer => this.nodes.has(layer.id))
      const nextLayers = [...custom, ...prepared.values()]
      if (new Set(nextLayers.map(layer => layer.id)).size !== nextLayers.length) throw new Error('场景对象与原生自定义图层 ID 冲突')
      if (nextLayers.some(layer => !layer.isMountedOn(this.viewer))) throw new Error('准备的图层未就绪')
      const time = scene.lighting ? JulianDate.fromIso8601(scene.lighting.time) : JulianDate.clone(this.originalLighting.time)
      // Preparation guarantees end here; host exceptions/reentrant writes inside native setters need host rollback.
      committing = true
      this.cancelDraw(); this.cancelGraphicEditing(); this.stopEditing()
      if (nextEnvironment) this.installEnvironment(nextEnvironment)
      this.environmentRevision++; this.sceneRevision++
      this.layers.replaceMountedLayers(nextLayers)
      previousManaged.forEach(layer => layer.destroy())
      this.scene = scene
      this.nodes.clear(); this.nativeKeys.clear(); this.currentLayers.clear(); this.layerReady.clear()
      for (const node of definitions.values()) {
        const layer = prepared.get(node.id)!
        this.nodes.set(node.id, structuredClone(node)); this.nativeKeys.set(node.id, nativeKey(node, scene)); this.currentLayers.set(node.id, layer)
        layer.on('click', event => this.options.onSelect?.(node.id, event.properties, event.selection))
        layer.on('error', error => {
          if (!this.destroyed && this.currentLayers.get(node.id) === layer) this.options.onLayerState?.(node.id, 'error', error)
        })
        layer.show = node.visible
        this.applySelection(layer)
      }
      this.effects.update(scene.effects)
      if (this.viewer.scene.globe) this.viewer.scene.globe.enableLighting = scene.lighting?.sunlight ?? this.originalLighting.sunlight
      this.viewer.shadows = scene.lighting?.shadows ?? this.originalLighting.shadows
      if (this.viewer.clock) this.viewer.clock.currentTime = time
      this.lightingKey = JSON.stringify(scene.lighting ?? null)
      if (!options.preserveCamera) this.setCamera(scene.camera)
      this.editor.refresh()
      committed = true
      prepared.clear()
      for (const node of definitions.values()) this.options.onLayerState?.(node.id, 'ready')
    } finally {
      committing = false
      release()
      operation.signal.removeEventListener('abort', release)
      operation.signal.removeEventListener('abort', rejectAborted)
      signal?.removeEventListener('abort', abort)
      if (this.preparation === operation) this.preparation = null
    }
  }

  /** Updates ready native objects without reloading resources or resetting an unchanged camera. */
  updatePresentation(input: CityScene): boolean {
    if (this.destroyed) throw new Error('CitySceneRuntime 已销毁')
    const scene = parseCityScene(input)
    if (JSON.stringify([scene.basemap, scene.terrain]) !== this.environmentKey) return false
    if (scene.nodes.length !== this.nodes.size || scene.nodes.some(node => {
      const layer = this.layers.getLayer(node.id)
      return !layer?.isMountedOn(this.viewer) || this.nativeKeys.get(node.id) !== nativeKey(node, scene)
    })) return false
    const cameraChanged = JSON.stringify(scene.camera) !== JSON.stringify(this.scene.camera)
    const time = scene.lighting ? JulianDate.fromIso8601(scene.lighting.time) : JulianDate.clone(this.originalLighting.time)
    this.cancelPreparation(); this.sceneRevision++
    this.cancelDraw(); this.cancelGraphicEditing(); this.editor.cancel()
    for (const definition of scene.nodes) {
      const node = { ...definition, ...getCityNodeState(scene, definition) }, layer = this.layers.getLayer(node.id)!
      this.nodes.set(node.id, structuredClone(node))
      layer.name = node.name; layer.show = node.visible
      if ((!node.visible || node.locked) && this.editingId === node.id) this.stopEditing()
      if ((layer instanceof TilesetLayer || layer instanceof ModelLayer) && (node.type === '3dtiles' || node.type === 'model')) layer.setTransform(node.transform)
      if (layer instanceof TilesetLayer && node.type === '3dtiles') layer.setQuality(node.maximumScreenSpaceError, node.cacheBytes)
      if (layer instanceof GraphicLayer && node.type === 'graphic') layer.getGraphic(node.id)?.setOptions(node)
      if (layer instanceof GeoJsonLayer && node.type === 'geojson') layer.setColor(node.color ?? '#55a6ff')
        if (layer instanceof ImageryTemplateLayer && node.type === 'imagery' && node.opacity !== undefined) layer.setOpacity(node.opacity)
      if (node.popup) layer.bindPopup(node.popup); else layer.unbindPopup()
      this.applySelection(layer)
    }
    this.effects.update(scene.effects)
    const lightingKey = JSON.stringify(scene.lighting ?? null)
    if (lightingKey !== this.lightingKey) {
      if (this.viewer.scene.globe) this.viewer.scene.globe.enableLighting = scene.lighting?.sunlight ?? this.originalLighting.sunlight
      this.viewer.shadows = scene.lighting?.shadows ?? this.originalLighting.shadows
      if (this.viewer.clock) this.viewer.clock.currentTime = time
      this.lightingKey = lightingKey
    }
    this.scene = scene
    if (cameraChanged) this.setCamera(scene.camera)
    this.editor.refresh(); this.viewer.scene.requestRender()
    return true
  }

  cancelPreparation(): void { this.preparation?.abort(); this.preparation = null }

  startEditing(id: string, mode: EditMode = 'translate'): void {
    this.cancelDraw(); this.cancelGraphicEditing()
    const layer = this.layers.getLayer(id)
    if (!(layer instanceof TilesetLayer || layer instanceof ModelLayer)) throw new Error('请选择已加载的模型或 3D Tiles 图层')
    if (!layer.show) throw new Error('隐藏图层不能编辑')
    if (this.nodes.get(id)?.locked) throw new Error('锁定对象不能编辑')
    this.editor.setMode(mode); this.editor.startEditing(layer); this.editingId = id
  }
  stopEditing(): void { this.cancelGraphicEditing(); this.editor.stopEditing(); this.editingId = undefined; this.layers.pickingEnabled = true }
  startGraphicEditing(id: string, options: GraphicEditOptions = {}): EditSession {
    if (this.destroyed) throw new Error('CitySceneRuntime 已销毁')
    const layer = this.layers.getLayer(id)
    if (!(layer instanceof GraphicLayer)) throw new Error('请选择已加载的标绘图形')
    const definition = layer.getGraphic(id)?.toJSON()
    if (!definition || !layer.show || !definition.visible || definition.locked) throw new Error('隐藏或锁定图形不能编辑')
    this.stopEditing(); this.cancelDraw()
    const editing = layer.startEditing(id, options)
    this.graphicEditing = editing; this.layers.pickingEnabled = false; this.layers.layers.forEach(item => item.closePopup())
    void editing.result.then(() => { if (this.graphicEditing !== editing) return; this.graphicEditing = undefined; this.layers.pickingEnabled = true })
    return editing
  }
  cancelGraphicEditing(): void { const editing = this.graphicEditing; this.graphicEditing = undefined; editing?.cancel(); this.layers.pickingEnabled = true }
  setSelected(ids: readonly string[]): void {
    this.selectedIds = [...ids]
    this.layers.layers.forEach(layer => this.applySelection(layer))
  }
  private applySelection(layer: BaseLayer): void {
    if (layer instanceof GraphicLayer) layer.setSelected(this.selectedIds)
    else if (layer instanceof TilesetLayer || layer instanceof ModelLayer) layer.setHighlighted(this.selectedIds.includes(layer.id))
    else if (layer instanceof GeoJsonLayer) {
      const node = this.nodes.get(layer.id)
      if (node?.type === 'geojson') layer.setColor(this.selectedIds.includes(layer.id) ? '#3984d7' : node.color ?? '#55a6ff')
    }
  }
  startDraw(options: DrawOptions): DrawSession {
    if (this.destroyed) throw new Error('CitySceneRuntime 已销毁')
    this.stopEditing(); this.cancelDraw()
    const drawing = new DrawSession(this.viewer, options)
    this.drawing = drawing; this.layers.pickingEnabled = false; this.layers.layers.forEach(layer => layer.closePopup())
    void drawing.result.then(() => { if (this.drawing !== drawing) return; this.drawing = undefined; this.layers.pickingEnabled = true })
    return drawing
  }
  cancelDraw(): void { const drawing = this.drawing; this.drawing = undefined; drawing?.cancel(); this.layers.pickingEnabled = true }
  setPreview(enabled: boolean): void { this.stopEditing(); this.cancelDraw(); this.layers.popupsEnabled = enabled; this.layers.layers.forEach(layer => layer.closePopup()) }
  setEditMode(mode: EditMode): void { this.editor.setMode(mode) }
  setRenderQuality(quality: RenderQuality): void { applyRenderQuality(this.viewer, quality) }
  async flyTo(id: string): Promise<void> { await this.layers.getLayer(id)?.flyTo() }
  setCamera(camera: CityCamera): void {
    this.viewer.camera.setView({ destination: Cartesian3.fromDegrees(...camera.position), orientation: { heading: CesiumMath.toRadians(camera.heading), pitch: CesiumMath.toRadians(camera.pitch), roll: CesiumMath.toRadians(camera.roll) } })
  }
  getCamera(): CityCamera {
    const camera = this.viewer.camera, p = camera.positionCartographic
    return { position: [CesiumMath.toDegrees(p.longitude), CesiumMath.toDegrees(p.latitude), p.height], heading: CesiumMath.toDegrees(camera.heading), pitch: CesiumMath.toDegrees(camera.pitch), roll: CesiumMath.toDegrees(camera.roll) }
  }
  getNativeViewer(): Viewer { return this.viewer }
  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true; this.cancelPreparation(); this.environmentRevision++; this.sceneRevision++; this.layerReady.clear(); this.currentLayers.clear()
    this.cancelDraw(); this.cancelGraphicEditing(); this.editor.destroy(); this.layers.destroy(); this.effects.destroy()
    if (this.baseLayer) this.viewer.imageryLayers.remove(this.baseLayer, true)
    if (this.options.ownsViewer !== false) this.viewer.destroy()
    else {
      if (this.originalTerrain) this.viewer.terrainProvider = this.originalTerrain
      if (this.viewer.scene.globe) this.viewer.scene.globe.enableLighting = this.originalLighting.sunlight
      this.viewer.shadows = this.originalLighting.shadows
      if (this.viewer.clock) this.viewer.clock.currentTime = JulianDate.clone(this.originalLighting.time)
      this.viewer.scene.requestRender()
    }
  }

  private resource(url: string): Resource {
    const resolved = new URL(url, this.options.sceneUrl ?? document.baseURI).href
    return this.options.resolveResource?.(resolved) ?? new Resource({ url: resolved })
  }
  private createLayer(node: CityNode, scene: CityScene): BaseLayer {
    const base = { id: node.id, name: node.name, show: node.visible }
    if (node.type === 'graphic') return new GraphicLayer({ ...base, graphics: [node] })
    if (node.type === 'water') return new WaterLayer({ ...base, ...node })
    if (node.type === 'imagery') {
      return new ImageryTemplateLayer({
        ...base,
        url: this.resource(node.url),
        attribution: node.attribution,
        maximumLevel: node.maximumLevel,
        opacity: node.opacity
      })
    }
    const asset = scene.assets[node.asset]
    if (node.type === '3dtiles') return new TilesetLayer({ ...base, url: this.resource(asset.url!), transform: node.transform, maximumScreenSpaceError: node.maximumScreenSpaceError, cacheBytes: node.cacheBytes })
    if (node.type === 'model') return new ModelLayer({ ...base, url: this.resource(asset.url!), position: node.position, transform: node.transform })
    return new GeoJsonLayer({ ...base, data: asset.data ?? this.resource(asset.url!), color: node.color })
  }

  private async updateEnvironment(scene: CityScene): Promise<void> {
    const key = JSON.stringify([scene.basemap, scene.terrain])
    if (key === this.environmentKey) return
    const revision = ++this.environmentRevision
    const prepared = await this.prepareEnvironment(scene)
    if (this.destroyed || revision !== this.environmentRevision) return
    this.installEnvironment(prepared)
  }

  private async prepareEnvironment(scene: CityScene): Promise<PreparedEnvironment> {
    const imagery = scene.basemap
      ? new UrlTemplateImageryProvider({ url: this.resource(scene.basemap.url), credit: scene.basemap.attribution })
      : await TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'))
    const terrain = scene.terrain ? await CesiumTerrainProvider.fromUrl(this.resource(scene.terrain.url)) : new EllipsoidTerrainProvider()
    return { key: JSON.stringify([scene.basemap, scene.terrain]), imagery, terrain }
  }

  private installEnvironment(prepared: PreparedEnvironment): void {
    const previous = this.baseLayer, terrain = this.viewer.terrainProvider
    const layer = this.viewer.imageryLayers.addImageryProvider(prepared.imagery, 0)
    try { this.viewer.terrainProvider = prepared.terrain }
    catch (error) { this.viewer.imageryLayers.remove(layer, true); this.viewer.terrainProvider = terrain; throw error }
    this.baseLayer = layer
    if (previous) this.viewer.imageryLayers.remove(previous, true)
    this.environmentKey = prepared.key
    this.viewer.scene.requestRender()
  }
}

function nativeKey(node: CityNode, scene: CityScene): string {
  if (node.type === 'graphic') return 'graphic'
  if (node.type === 'imagery') return JSON.stringify({ url: node.url, attribution: node.attribution, maximumLevel: node.maximumLevel })
  if (node.type === 'geojson') return JSON.stringify([node.asset, scene.assets[node.asset]])
  const { popup: _popup, visible: _visible, locked: _locked, name: _name, groupId: _groupId, ...rest } = node
  if (node.type === 'water') return JSON.stringify(rest)
  const { transform: _transform, maximumScreenSpaceError: _error, cacheBytes: _cache, ...assetNode } = rest as typeof rest & { transform?: unknown; maximumScreenSpaceError?: number; cacheBytes?: number }
  return JSON.stringify([assetNode, scene.assets[node.asset]])
}

export function createCityRuntime(options: CityRuntimeOptions): CitySceneRuntime { return createRuntime(options, true) }

function createRuntime(options: CityRuntimeOptions, initializeCamera: boolean): CitySceneRuntime {
  const scene = parseCityScene(options.scene)
  if (options.cesiumBaseUrl) (globalThis as typeof globalThis & { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = options.cesiumBaseUrl
  if (!options.viewer && !options.target) throw new Error('Provide a viewer or target')
  const viewer = options.viewer ?? new Viewer(options.target!, { animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, selectionIndicator: false, infoBox: false, baseLayer: false, requestRenderMode: true, maximumRenderTimeChange: Infinity })
  const runtime = new CitySceneRuntime(viewer, { ...options, scene, ownsViewer: options.ownsViewer ?? !options.viewer })
  try {
    if (options.renderQuality || !options.viewer) runtime.setRenderQuality(options.renderQuality ?? defaultRenderQuality)
    if (initializeCamera) runtime.setCamera(scene.camera)
  } catch (error) { runtime.destroy(); throw error }
  return runtime
}

export interface CesiumDocumentRuntime {
  readonly runtime: CitySceneRuntime
  readonly issues: readonly CesiumDocumentIssue[]
  /** Full input content, including definitions unsupported by the native city projection. */
  getDocument(): SceneDocument
  /** Applies a validated snapshot; aborted preparation cannot publish obsolete native content. */
  updateDocument(document: unknown, signal?: AbortSignal, options?: { reload?: boolean }): Promise<void>
  destroy(): void
}

/** Creates and loads a native projection; low-level native edits still require host document updates. */
export async function createCesiumDocumentRuntime(options: Omit<CityRuntimeOptions, 'scene'> & { document: unknown; viewId?: string; signal?: AbortSignal }): Promise<CesiumDocumentRuntime> {
  let projection = projectCesiumDocument(options.document, options.viewId)
  const runtime = createRuntime({ ...options, scene: projection.scene }, false)
  try { await runtime.replaceScene(projection.scene, options.signal) }
  catch (error) { runtime.destroy(); throw error }
  let revision = 0, destroyed = false
  return {
    runtime,
    get issues() { return structuredClone(projection.issues) },
    getDocument: () => structuredClone(projection.document),
    async updateDocument(document, signal, updateOptions) {
      if (destroyed) throw new Error('CesiumDocumentRuntime 已销毁')
      signal?.throwIfAborted()
      const next = projectCesiumDocument(document, options.viewId)
      const cameraChanged = projection.document.id !== next.document.id || JSON.stringify(projection.scene.camera) !== JSON.stringify(next.scene.camera)
      const nativeChanged = JSON.stringify(projection.scene) !== JSON.stringify(next.scene)
      const current = ++revision
      runtime.cancelPreparation()
      if (updateOptions?.reload || nativeChanged && !runtime.updatePresentation(next.scene)) await runtime.replaceScene(next.scene, signal, { preserveCamera: !cameraChanged })
      else if (projection.document.id !== next.document.id) { runtime.cancelDraw(); runtime.stopEditing(); runtime.setCamera(next.scene.camera) }
      signal?.throwIfAborted()
      if (destroyed || revision !== current) throw new DOMException('Scene projection superseded', 'AbortError')
      projection = next
    },
    destroy() { if (destroyed) return; destroyed = true; revision++; runtime.destroy() }
  }
}
