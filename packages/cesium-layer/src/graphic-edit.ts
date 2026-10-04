import { Cartesian3, Cartographic, Color, EllipsoidGeodesic, HeightReference, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium'
import type { Cartesian2, Entity, Viewer } from 'cesium'
import { validateGraphic } from '@desktop-webgis/cesium-scene-schema'
import type { GeoPosition, GraphicGeometry } from '@desktop-webgis/cesium-scene-schema'
import type { Graphic } from './graphic-layer.js'
import { claimInteraction, releaseInteraction } from './interaction.js'

export interface EditState { geometry: GraphicGeometry; selectedIndex: number }
export interface GraphicEditOptions { onChange?: (state: EditState) => void }
export type GraphicEditResult = { status: 'completed'; id: string; before: GraphicGeometry; after: GraphicGeometry; changed: boolean } | { status: 'cancelled' }
interface Handle { entity: Entity; index: number; midpoint: boolean }

/** Previews changes on a Graphic; only finish returns a durable, undoable result. */
export class EditSession {
  readonly result: Promise<GraphicEditResult>
  readonly id: string
  readonly minimum: number
  private resolve!: (result: GraphicEditResult) => void
  private readonly input: ScreenSpaceEventHandler
  private readonly keyTarget: Window | null
  private readonly before: GraphicGeometry
  private geometry: GraphicGeometry
  private handles: Handle[] = []
  private selectedIndex = 0
  private dragging = false
  private cameraEnabled?: boolean
  private active = true

  constructor(private readonly viewer: Viewer, private readonly graphic: Graphic, private readonly options: GraphicEditOptions = {}) {
    const definition = graphic.toJSON()
    if (viewer.isDestroyed()) throw new Error('Viewer 已销毁')
    if (!definition.visible || definition.locked) throw new Error('隐藏或锁定图形不能编辑')
    this.id = definition.id
    this.result = new Promise(resolve => { this.resolve = resolve })
    this.input = new ScreenSpaceEventHandler(viewer.canvas)
    this.keyTarget = viewer.canvas.ownerDocument?.defaultView ?? null
    claimInteraction(viewer, this)
    this.before = structuredClone(graphic.toJSON().geometry)
    this.geometry = structuredClone(this.before)
    this.minimum = this.geometry.type === 'point' ? 1 : this.geometry.type === 'polyline' ? 2 : 3
    this.input.setInputAction((event: { position: Cartesian2 }) => this.beginDrag(event.position), ScreenSpaceEventType.LEFT_DOWN)
    this.input.setInputAction((event: { endPosition: Cartesian2 }) => this.drag(event.endPosition), ScreenSpaceEventType.MOUSE_MOVE)
    this.input.setInputAction(() => this.endDrag(), ScreenSpaceEventType.LEFT_UP)
    this.keyTarget?.addEventListener('keydown', this.handleKey, true)
    this.keyTarget?.addEventListener('blur', this.cancel)
    this.keyTarget?.addEventListener('mouseup', this.endDrag)
    this.renderHandles()
  }
  get isActive(): boolean { return this.active }
  get state(): EditState { return { geometry: structuredClone(this.geometry), selectedIndex: this.selectedIndex } }
  selectVertex(index: number): void {
    this.assertIndex(index)
    this.selectedIndex = index; this.renderHandles(); this.emitChange()
  }
  setVertexPosition(index: number, position: GeoPosition): void {
    this.assertIndex(index)
    const next = structuredClone(this.geometry); next.positions[index] = [...position]
    this.apply(next, index)
  }
  insertVertex(afterIndex: number, position?: GeoPosition): void {
    this.assertIndex(afterIndex)
    if (this.geometry.type === 'point' || (this.geometry.type === 'polyline' && afterIndex === this.geometry.positions.length - 1)) throw new Error('请选择一条边插入顶点')
    const next = structuredClone(this.geometry)
    const value = position ?? this.midpoint(afterIndex)
    if (!value) throw new Error('无法计算此边的中点，请输入坐标')
    next.positions.splice(afterIndex + 1, 0, [...value]); this.apply(next, afterIndex + 1)
  }
  removeVertex(index: number): boolean {
    this.assertIndex(index)
    if (this.geometry.positions.length <= this.minimum) return false
    const next = structuredClone(this.geometry); next.positions.splice(index, 1)
    this.apply(next, Math.min(index, next.positions.length - 1)); return true
  }
  finish = (): boolean => {
    if (!this.active) return false
    const after = structuredClone(this.geometry)
    this.release()
    this.resolve({ status: 'completed', id: this.id, before: structuredClone(this.before), after, changed: JSON.stringify(this.before) !== JSON.stringify(after) })
    return true
  }
  cancel = (): void => {
    if (!this.active) return
    this.release()
    this.graphic.setOptions({ geometry: this.before })
    this.resolve({ status: 'cancelled' })
  }
  destroy(): void { this.cancel() }
  private assertIndex(index: number): void {
    if (!this.active) throw new Error('编辑会话已结束')
    if (!Number.isInteger(index) || index < 0 || index >= this.geometry.positions.length) throw new Error('顶点索引无效')
  }
  private apply(geometry: GraphicGeometry, selectedIndex: number): void {
    if (!validateGraphic({ ...this.graphic.toJSON(), geometry })) throw new Error('坐标无效或顶点重复')
    const distinct = new Set(geometry.positions.map(p => geometry.type === 'polygon' ? `${p[0]},${p[1]}` : JSON.stringify(p)))
    if (distinct.size !== geometry.positions.length) throw new Error('顶点不能重复')
    this.geometry = geometry; this.selectedIndex = selectedIndex
    this.graphic.setOptions({ geometry }); this.renderHandles(); this.emitChange()
  }
  private emitChange(): void { this.options.onChange?.(this.state) }
  private midpoint(index: number): GeoPosition | undefined {
    const a = this.geometry.positions[index], b = this.geometry.positions[(index + 1) % this.geometry.positions.length]
    try {
      const point = new EllipsoidGeodesic(Cartographic.fromDegrees(...a), Cartographic.fromDegrees(...b)).interpolateUsingFraction(.5)
      return [CesiumMath.toDegrees(point.longitude), CesiumMath.toDegrees(point.latitude), (a[2] + b[2]) / 2]
    } catch { return undefined }
  }
  private renderHandles(): void {
    if (!this.active || this.viewer.isDestroyed()) return
    this.clearHandles()
    const add = (position: GeoPosition, index: number, midpoint: boolean): void => {
      const entity = this.viewer.entities.add({ position: Cartesian3.fromDegrees(...position), point: {
        pixelSize: midpoint ? 8 : 12, color: midpoint ? Color.WHITE : index === this.selectedIndex ? Color.fromCssColorString('#f2ad43') : Color.fromCssColorString('#3984d7'),
        outlineColor: Color.WHITE, outlineWidth: midpoint ? 1 : 2, disableDepthTestDistance: Number.POSITIVE_INFINITY,
        heightReference: this.geometry.heightMode === 'ground' ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE
      } })
      this.handles.push({ entity, index, midpoint })
    }
    this.geometry.positions.forEach((position, index) => {
      add(position, index, false)
      if (this.geometry.type === 'point' || (this.geometry.type === 'polyline' && index === this.geometry.positions.length - 1)) return
      const midpoint = this.midpoint(index); if (midpoint) add(midpoint, index, true)
    })
    this.viewer.scene.requestRender()
  }
  private beginDrag(position: Cartesian2): void {
    if (!this.active) return
    const picked = this.viewer.scene.pick(position) as { id?: Entity } | undefined
    const handle = this.handles.find(candidate => candidate.entity === picked?.id)
    if (!handle) return
    if (handle.midpoint) this.insertVertex(handle.index)
    else this.selectVertex(handle.index)
    this.dragging = true
    const controller = this.viewer.scene.screenSpaceCameraController
    this.cameraEnabled = controller.enableInputs; controller.enableInputs = false
  }
  private drag(position: Cartesian2): void {
    if (!this.active || !this.dragging) return
    // Handles must not become their own depth-pick surface. Preserve height while moving horizontally.
    const ray = this.viewer.camera.getPickRay(position)
    const point = (ray && this.viewer.scene.globe.pick(ray, this.viewer.scene)) || this.viewer.camera.pickEllipsoid(position)
    if (!point) return
    const p = Cartographic.fromCartesian(point)
    try { this.setVertexPosition(this.selectedIndex, [CesiumMath.toDegrees(p.longitude), CesiumMath.toDegrees(p.latitude), this.geometry.positions[this.selectedIndex][2]]) } catch { /* Keep the last valid geometry when crossing another vertex. */ }
  }
  private endDrag = (): void => {
    this.dragging = false
    if (this.cameraEnabled !== undefined && !this.viewer.isDestroyed()) this.viewer.scene.screenSpaceCameraController.enableInputs = this.cameraEnabled
    this.cameraEnabled = undefined
  }
  private handleKey = (event: KeyboardEvent): void => {
    if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return
    if (event.key === 'Escape') { event.preventDefault(); this.cancel() }
    else if (event.key === 'Enter') { event.preventDefault(); this.finish() }
    else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); this.removeVertex(this.selectedIndex) }
  }
  private clearHandles(): void { this.handles.forEach(handle => this.viewer.entities.remove(handle.entity)); this.handles = [] }
  private release(): void {
    this.active = false; this.endDrag(); this.input.destroy()
    this.keyTarget?.removeEventListener('keydown', this.handleKey, true)
    this.keyTarget?.removeEventListener('blur', this.cancel)
    this.keyTarget?.removeEventListener('mouseup', this.endDrag)
    if (!this.viewer.isDestroyed()) { this.clearHandles(); this.viewer.scene.requestRender() }
    releaseInteraction(this.viewer, this)
  }
}
