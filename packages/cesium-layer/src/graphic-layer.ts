import { Cartesian2, Cartesian3, Color, CustomDataSource, Entity, HeightReference, JulianDate, LabelStyle, PolygonHierarchy, VerticalOrigin } from 'cesium'
import type { Viewer } from 'cesium'
import { validateGraphic } from '@desktop-webgis/cesium-scene-schema'
import type { BillboardStyle, GraphicNode, PopupDefinition } from '@desktop-webgis/cesium-scene-schema'
import type { PopupContent } from '@desktop-webgis/cesium-popup'
import { BaseLayer } from './base-layer.js'
import type { LayerClickEvent, LayerOptions } from './base-layer.js'
import { DrawSession } from './draw.js'
import type { DrawOptions } from './draw.js'
import { EditSession } from './graphic-edit.js'
import type { GraphicEditOptions } from './graphic-edit.js'
import { resolveGraphicLabel } from './graphic-label.js'

interface SharedGraphicSource {
  source: CustomDataSource
  references: number
  ready: Promise<void>
}

const graphicSources = new WeakMap<Viewer, SharedGraphicSource>()
let graphicLayerSequence = 0

async function acquireGraphicSource(viewer: Viewer): Promise<{ source: CustomDataSource; release(): void }> {
  let shared = graphicSources.get(viewer)
  if (!shared) {
    const source = new CustomDataSource('三维标绘')
    shared = { source, references: 0, ready: Promise.resolve(viewer.dataSources.add(source)).then(() => {}) }
    graphicSources.set(viewer, shared)
    void shared.ready.catch(() => { if (graphicSources.get(viewer) === shared) graphicSources.delete(viewer) })
  }
  shared.references++
  try { await shared.ready }
  catch (error) { shared.references--; throw error }
  let released = false
  return { source: shared.source, release() {
    if (released) return
    released = true; shared.references--
    if (shared.references === 0 && graphicSources.get(viewer) === shared) {
      graphicSources.delete(viewer)
      if (!viewer.isDestroyed()) viewer.dataSources.remove(shared.source, true)
    }
  } }
}

/** Serializable spatial object; native rendering is owned by its GraphicLayer. */
export class Graphic {
  private definition: GraphicNode
  constructor(definition: GraphicNode, private readonly changed: () => void = () => {}) { this.definition = this.validate(definition) }
  get id(): string { return this.definition.id }
  toJSON(): GraphicNode { return structuredClone(this.definition) }
  setOptions(patch: Partial<Omit<GraphicNode, 'id' | 'type'>>): void {
    const next = this.validate({ ...this.definition, ...patch })
    if (next.id !== this.id) throw new Error('图形 ID 不可修改')
    this.definition = next; this.changed()
  }
  bindPopup(popup: PopupDefinition): this { this.setOptions({ popup }); return this }
  unbindPopup(): this { this.setOptions({ popup: undefined }); return this }
  private validate(definition: GraphicNode): GraphicNode { if (!validateGraphic(definition)) throw new Error('图形几何或样式无效'); return structuredClone(definition) }
}

/** Shares the resource lifecycle and pick routing of other Cesium layers. */
export class GraphicLayer extends BaseLayer {
  private readonly graphics = new Map<string, Graphic>()
  private readonly nativePrefix = `graphic-layer-${++graphicLayerSequence}:`
  private readonly nativeIds = new Map<string, string>()
  private source?: CustomDataSource
  private drawing?: DrawSession
  private editing?: EditSession
  private readonly selected = new Set<string>()
  constructor(options: LayerOptions & { graphics?: GraphicNode[] }) { super(options); options.graphics?.forEach(graphic => this.addGraphic(graphic)) }
  getGraphic(id: string): Graphic | undefined { return this.graphics.get(id) }
  get allGraphics(): Graphic[] { return [...this.graphics.values()] }
  addGraphic(definition: GraphicNode): Graphic {
    if (this.graphics.has(definition.id)) throw new Error(`重复图形 ID：${definition.id}`)
    const graphic = new Graphic(definition, () => this.renderGraphic(graphic))
    this.graphics.set(graphic.id, graphic); this.renderGraphic(graphic); return graphic
  }
  removeGraphic(id: string): void { if (this.editing?.id === id) this.editing.cancel(); this.graphics.delete(id); this.selected.delete(id); const nativeId = this.nativeIds.get(id); if (nativeId) this.source?.entities.removeById(nativeId); this.nativeIds.delete(id); this.viewer?.scene.requestRender() }
  setSelected(ids: readonly string[]): void {
    this.selected.clear(); ids.forEach(id => this.selected.add(id))
    this.allGraphics.forEach(graphic => this.renderGraphic(graphic))
  }
  toJSON(): GraphicNode[] { return this.allGraphics.map(graphic => graphic.toJSON()) }
  /** Native property values used by diagnostics without exposing mutable Cesium objects. */
  getGraphicPresentation(id: string): { point: boolean; billboard?: BillboardStyle; label?: string } | undefined {
    const nativeId = this.nativeIds.get(id), entity = nativeId ? this.source?.entities.getById(nativeId) : undefined
    if (!entity) return
    const time = JulianDate.now()
    return { point: Boolean(entity.point), ...(entity.billboard ? { billboard: { image: entity.billboard.image?.getValue(time), width: entity.billboard.width?.getValue(time), height: entity.billboard.height?.getValue(time) } } : {}), ...(entity.label ? { label: entity.label.text?.getValue(time) } : {}) }
  }
  startDraw(options: DrawOptions): DrawSession {
    if (!this.viewer || this.state !== 'ready' || !this.show) throw new Error('请先挂载并显示图形层')
    this.drawing?.cancel(); return this.drawing = new DrawSession(this.viewer, options)
  }
  startEditing(id: string, options: GraphicEditOptions = {}): EditSession {
    if (!this.viewer || this.state !== 'ready' || !this.show) throw new Error('请先挂载并显示图形层')
    const graphic = this.getGraphic(id)
    if (!graphic) throw new Error('图形不存在')
    const editing = new EditSession(this.viewer, graphic, options)
    this.editing = editing
    void editing.result.then(() => { if (this.editing === editing) this.editing = undefined })
    return editing
  }
  contains(picked: unknown): boolean { return Boolean(picked && typeof picked === 'object' && 'id' in picked && picked.id instanceof Entity && [...this.nativeIds.values()].includes(picked.id.id)) }
  async flyTo(): Promise<void> {
    if (!this.viewer || !this.source || !this.graphics.size) return
    const entities = [...this.nativeIds.values()].flatMap(id => this.source?.entities.getById(id) ?? [])
    if (entities.length) await this.viewer.flyTo(entities.length === 1 ? entities[0] : entities)
  }
  protected getPopupContent(event: LayerClickEvent): PopupContent | undefined {
    const picked = event.picked
    const entity = picked && typeof picked === 'object' && 'id' in picked && picked.id instanceof Entity ? picked.id : undefined
    const id = entity ? [...this.nativeIds].find(([, nativeId]) => nativeId === entity.id)?.[0] : undefined
    const graphic = id ? this.graphics.get(id) : undefined
    return graphic?.toJSON().popup ?? super.getPopupContent(event)
  }
  protected setNativeVisible(show: boolean): void { this.allGraphics.forEach(graphic => this.renderGraphic(graphic)); if (!show) { this.drawing?.cancel(); this.editing?.cancel() } }
  protected async createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void> {
    const shared = await acquireGraphicSource(viewer), source = shared.source
    if (signal.aborted || viewer.isDestroyed()) { shared.release(); return () => {} }
    this.source = source; this.allGraphics.forEach(graphic => this.renderGraphic(graphic))
    return () => {
      this.drawing?.cancel(); this.editing?.cancel()
      this.nativeIds.forEach(id => source.entities.removeById(id)); this.nativeIds.clear()
      if (this.source === source) this.source = undefined
      shared.release()
    }
  }
  private renderGraphic(graphic: Graphic): void {
    if (!this.source) return
    const node = graphic.toJSON(), positions = node.geometry.positions.map(position => Cartesian3.fromDegrees(...position)), color = Color.fromCssColorString(node.style.color), ground = node.geometry.heightMode === 'ground'
    const selected = this.selected.has(node.id), stroke = selected ? Color.fromCssColorString('#3984d7') : color
    const label = resolveGraphicLabel(node)
    const nativeId = this.nativeIds.get(node.id) ?? `${this.nativePrefix}${node.id}`
    this.nativeIds.set(node.id, nativeId); this.source.entities.removeById(nativeId)
    this.source.entities.add({
      id: nativeId, name: node.name, show: this.show && node.visible, properties: { name: node.name, ...node.properties }, position: positions[0],
      point: node.geometry.type === 'point' && !node.style.billboard ? { pixelSize: node.style.pointSize, color, outlineColor: stroke, outlineWidth: selected ? 3 : 0, heightReference: ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE, disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
      billboard: node.style.billboard ? { ...node.style.billboard, scale: selected ? 1.12 : 1, verticalOrigin: VerticalOrigin.BOTTOM, heightReference: ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE, disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
      polyline: node.geometry.type !== 'point' ? { positions: node.geometry.type === 'polygon' ? [...positions,positions[0]] : positions, width: selected ? Math.max(node.style.width, 4) : node.style.width, material: stroke, clampToGround: ground } : undefined,
      polygon: node.geometry.type === 'polygon' ? { hierarchy: new PolygonHierarchy(positions), material: color.withAlpha(color.alpha * .35), perPositionHeight: !ground } : undefined,
      label: label ? { text: label, font: '14px sans-serif', fillColor: color, style: LabelStyle.FILL_AND_OUTLINE, outlineColor: Color.WHITE, outlineWidth: 3, pixelOffset: new Cartesian2(0, node.style.billboard ? -node.style.billboard.height - 8 : -16), disableDepthTestDistance: Number.POSITIVE_INFINITY, heightReference: ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE } : undefined
    })
    this.viewer?.scene.requestRender()
  }
}
