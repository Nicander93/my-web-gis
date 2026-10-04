import { Cartesian2, Cartesian3, Color, CustomDataSource, Entity, HeightReference, LabelStyle, PolygonHierarchy } from 'cesium'
import type { Viewer } from 'cesium'
import { validateGraphic } from '@desktop-webgis/cesium-scene-schema'
import type { GraphicNode, PopupDefinition } from '@desktop-webgis/cesium-scene-schema'
import type { PopupContent } from '@desktop-webgis/cesium-popup'
import { BaseLayer } from './base-layer.js'
import type { LayerClickEvent, LayerOptions } from './base-layer.js'
import { DrawSession } from './draw.js'
import type { DrawOptions } from './draw.js'
import { EditSession } from './graphic-edit.js'
import type { GraphicEditOptions } from './graphic-edit.js'
import { resolveGraphicLabel } from './graphic-label.js'

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
  removeGraphic(id: string): void { if (this.editing?.id === id) this.editing.cancel(); this.graphics.delete(id); this.selected.delete(id); this.source?.entities.removeById(id); this.viewer?.scene.requestRender() }
  setSelected(ids: readonly string[]): void {
    this.selected.clear(); ids.forEach(id => this.selected.add(id))
    this.allGraphics.forEach(graphic => this.renderGraphic(graphic))
  }
  toJSON(): GraphicNode[] { return this.allGraphics.map(graphic => graphic.toJSON()) }
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
  contains(picked: unknown): boolean { return Boolean(picked && typeof picked === 'object' && 'id' in picked && picked.id instanceof Entity && this.source?.entities.contains(picked.id)) }
  async flyTo(): Promise<void> { if (this.viewer && this.source && this.graphics.size) await this.viewer.flyTo(this.source) }
  protected getPopupContent(event: LayerClickEvent): PopupContent | undefined {
    const picked = event.picked
    const graphic = picked && typeof picked === 'object' && 'id' in picked && picked.id instanceof Entity ? this.graphics.get(picked.id.id) : undefined
    return graphic?.toJSON().popup ?? super.getPopupContent(event)
  }
  protected setNativeVisible(show: boolean): void { if (this.source) this.source.show = show; if (!show) { this.drawing?.cancel(); this.editing?.cancel() } }
  protected async createNative(viewer: Viewer, signal: AbortSignal): Promise<() => void> {
    const source = new CustomDataSource(this.name)
    await viewer.dataSources.add(source)
    if (signal.aborted || viewer.isDestroyed()) { if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true); return () => {} }
    this.source = source; this.allGraphics.forEach(graphic => this.renderGraphic(graphic))
    return () => { this.drawing?.cancel(); this.editing?.cancel(); if (!viewer.isDestroyed()) viewer.dataSources.remove(source, true); if (this.source === source) this.source = undefined }
  }
  private renderGraphic(graphic: Graphic): void {
    if (!this.source) return
    const node = graphic.toJSON(), positions = node.geometry.positions.map(position => Cartesian3.fromDegrees(...position)), color = Color.fromCssColorString(node.style.color), ground = node.geometry.heightMode === 'ground'
    const selected = this.selected.has(node.id), stroke = selected ? Color.fromCssColorString('#3984d7') : color
    const label = resolveGraphicLabel(node)
    this.source.entities.removeById(node.id)
    this.source.entities.add({
      id: node.id, name: node.name, show: node.visible, properties: { name: node.name, ...node.properties }, position: positions[0],
      point: node.geometry.type === 'point' ? { pixelSize: node.style.pointSize, color, outlineColor: stroke, outlineWidth: selected ? 3 : 0, heightReference: ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE, disableDepthTestDistance: Number.POSITIVE_INFINITY } : undefined,
      polyline: node.geometry.type !== 'point' ? { positions: node.geometry.type === 'polygon' ? [...positions,positions[0]] : positions, width: selected ? Math.max(node.style.width, 4) : node.style.width, material: stroke, clampToGround: ground } : undefined,
      polygon: node.geometry.type === 'polygon' ? { hierarchy: new PolygonHierarchy(positions), material: color.withAlpha(color.alpha * .35), perPositionHeight: !ground } : undefined,
      label: label ? { text: label, font: '14px sans-serif', fillColor: color, style: LabelStyle.FILL_AND_OUTLINE, outlineColor: Color.WHITE, outlineWidth: 3, pixelOffset: new Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY, heightReference: ground ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE } : undefined
    })
    this.viewer?.scene.requestRender()
  }
}
