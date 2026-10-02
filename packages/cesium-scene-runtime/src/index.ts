import { Cartesian3, CesiumTerrainProvider, EllipsoidTerrainProvider, ImageryLayer, Math as CesiumMath, Resource, TileMapServiceImageryProvider, UrlTemplateImageryProvider, Viewer, buildModuleUrl } from 'cesium'
import { BaseLayer, GeoJsonLayer, LayerCollection, ModelLayer, TilesetLayer } from '@desktop-webgis/cesium-layer'
import { TilesetEditor } from '@desktop-webgis/cesium-tileset-edit'
import type { EditMode, TransformEditEvent } from '@desktop-webgis/cesium-tileset-edit'
import { CityEffects, WaterLayer } from '@desktop-webgis/cesium-effects'
import { parseCityScene } from '@desktop-webgis/cesium-scene-schema'
import type { CityCamera, CityNode, CityScene } from '@desktop-webgis/cesium-scene-schema'
export type { EditMode, TransformEditEvent } from '@desktop-webgis/cesium-tileset-edit'
export type { CityScene, CityNode, Transform } from '@desktop-webgis/cesium-scene-schema'

export interface CityRuntimeOptions {
  target: HTMLElement | string
  scene: CityScene
  /** Base URL of scene.json; resolves relative asset and terrain URLs. */
  sceneUrl?: string
  cesiumBaseUrl?: string
  /** Inject credentials at runtime rather than storing tokens in scene URLs. */
  resolveResource?: (url: string) => Resource
  onEdit?: (event: TransformEditEvent) => void
  onSelect?: (id: string | null) => void
  onLayerState?: (id: string, state: BaseLayer['state'], error?: Error) => void
}

/** Composes independent packages; editing and read-only viewers share this renderer. */
export class CitySceneRuntime {
  readonly layers: LayerCollection
  private readonly editor: TilesetEditor
  private readonly effects: CityEffects
  private readonly nodes = new Map<string, CityNode>()
  private readonly nativeKeys = new Map<string, string>()
  private scene: CityScene
  private editingId?: string
  private destroyed = false
  private baseLayer?: ImageryLayer
  private environmentRevision = 0
  private environmentKey = ''

  constructor(readonly viewer: Viewer, private readonly options: CityRuntimeOptions) {
    this.scene = parseCityScene(options.scene)
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
    // Cancel an in-flight gesture before applying authoritative state (undo/import/hide).
    this.editor.cancel()
    this.scene = scene
    this.effects.update(scene.effects)
    const promises: Promise<unknown>[] = []
    for (const id of this.nodes.keys()) {
      if (scene.nodes.some(node => node.id === id)) continue
      if (this.editingId === id) this.stopEditing()
      this.layers.removeLayer(id); this.nodes.delete(id); this.nativeKeys.delete(id)
    }
    for (const node of scene.nodes) {
      const previous = this.nodes.get(node.id)
      let layer = this.layers.getLayer(node.id)
      if (layer && previous && this.nativeKeys.get(node.id) !== nativeKey(node, scene)) {
        if (this.editingId === node.id) this.stopEditing()
        this.layers.removeLayer(node.id); layer = undefined
      }
      this.nodes.set(node.id, structuredClone(node))
      this.nativeKeys.set(node.id, nativeKey(node, scene))
      if (layer) {
        if (!node.visible && this.editingId === node.id) this.stopEditing()
        layer.show = node.visible
        if ((layer instanceof TilesetLayer || layer instanceof ModelLayer) && (node.type === '3dtiles' || node.type === 'model')) layer.setTransform(node.transform)
        if (node.popup) layer.bindPopup(node.popup); else layer.unbindPopup()
        continue
      }
      layer = this.createLayer(node, scene)
      if (node.popup) layer.bindPopup(node.popup)
      const mounted = layer
      mounted.on('click', () => this.options.onSelect?.(node.id))
      mounted.on('error', error => this.options.onLayerState?.(node.id, 'error', error))
      const pending = this.layers.addLayer(mounted).then(() => {
        if (this.destroyed || this.layers.getLayer(node.id) !== mounted) return
        const latest = this.nodes.get(node.id)
        if (latest && (latest.type === '3dtiles' || latest.type === 'model') && (mounted instanceof TilesetLayer || mounted instanceof ModelLayer)) mounted.setTransform(latest.transform)
        this.options.onLayerState?.(node.id, mounted.state)
      })
      this.options.onLayerState?.(node.id, 'loading')
      promises.push(pending)
    }
    this.editor.refresh()
    promises.push(this.updateEnvironment(scene))
    const results = await Promise.allSettled(promises)
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failures.length && !this.destroyed) throw new Error(failures.map(f => f.reason instanceof Error ? f.reason.message : String(f.reason)).join('\n'))
  }

  startEditing(id: string, mode: EditMode = 'translate'): void {
    const layer = this.layers.getLayer(id)
    if (!(layer instanceof TilesetLayer || layer instanceof ModelLayer)) throw new Error('请选择已加载的模型或 3D Tiles 图层')
    if (!layer.show) throw new Error('隐藏图层不能编辑')
    this.editor.setMode(mode); this.editor.startEditing(layer); this.editingId = id
  }
  stopEditing(): void { this.editor.stopEditing(); this.editingId = undefined; this.layers.pickingEnabled = true }
  setEditMode(mode: EditMode): void { this.editor.setMode(mode) }
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
    this.destroyed = true; this.environmentRevision++
    this.editor.destroy(); this.layers.destroy(); this.effects.destroy()
    this.viewer.destroy()
  }

  private resource(url: string): Resource {
    const resolved = new URL(url, this.options.sceneUrl ?? document.baseURI).href
    return this.options.resolveResource?.(resolved) ?? new Resource({ url: resolved })
  }
  private createLayer(node: CityNode, scene: CityScene): BaseLayer {
    const base = { id: node.id, name: node.name, show: node.visible }
    if (node.type === 'water') return new WaterLayer({ ...base, ...node })
    const resource = this.resource(scene.assets[node.asset].url)
    if (node.type === '3dtiles') return new TilesetLayer({ ...base, url: resource, transform: node.transform, maximumScreenSpaceError: node.maximumScreenSpaceError, cacheBytes: node.cacheBytes })
    if (node.type === 'model') return new ModelLayer({ ...base, url: resource, position: node.position, transform: node.transform })
    return new GeoJsonLayer({ ...base, data: resource, color: node.color })
  }

  private async updateEnvironment(scene: CityScene): Promise<void> {
    const key = JSON.stringify([scene.basemap, scene.terrain])
    if (key === this.environmentKey) return
    const revision = ++this.environmentRevision
    const imagery = scene.basemap
      ? new UrlTemplateImageryProvider({ url: this.resource(scene.basemap.url), credit: scene.basemap.attribution })
      : await TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII'))
    const terrain = scene.terrain ? await CesiumTerrainProvider.fromUrl(this.resource(scene.terrain.url)) : new EllipsoidTerrainProvider()
    if (this.destroyed || revision !== this.environmentRevision) return
    if (this.baseLayer) this.viewer.imageryLayers.remove(this.baseLayer, true)
    this.baseLayer = this.viewer.imageryLayers.addImageryProvider(imagery, 0)
    this.viewer.terrainProvider = terrain
    this.environmentKey = key
    this.viewer.scene.requestRender()
  }
}

function nativeKey(node: CityNode, scene: CityScene): string {
  const { popup: _popup, visible: _visible, ...rest } = node
  if (node.type === 'water') return JSON.stringify(rest)
  const { transform: _transform, ...assetNode } = rest as typeof rest & { transform?: unknown }
  return JSON.stringify([assetNode, scene.assets[node.asset]])
}

export function createCityRuntime(options: CityRuntimeOptions): CitySceneRuntime {
  const scene = parseCityScene(options.scene)
  if (options.cesiumBaseUrl) (globalThis as typeof globalThis & { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = options.cesiumBaseUrl
  const viewer = new Viewer(options.target, { animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, selectionIndicator: false, infoBox: false, baseLayer: false, requestRenderMode: true, maximumRenderTimeChange: Infinity })
  const runtime = new CitySceneRuntime(viewer, { ...options, scene })
  runtime.setCamera(scene.camera)
  return runtime
}
