import { Cartesian3, Cartographic, Color, ConstantPositionProperty, ConstantProperty, HeightReference, Math as CesiumMath, PolygonHierarchy, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium'
import type { Cartesian2, Entity, Viewer } from 'cesium'
import type { GeoPosition, GraphicNode, GraphicStyle, GraphicType } from '@desktop-webgis/cesium-scene-schema'
import { validateGraphic } from '@desktop-webgis/cesium-scene-schema'

export interface DrawOptions {
  type: GraphicType
  id?: string
  name?: string
  heightMode?: 'ground' | 'absolute'
  style?: Partial<GraphicStyle>
  properties?: Record<string, unknown>
  onChange?: (count: number) => void
}
export type DrawResult = { status: 'completed'; graphic: GraphicNode } | { status: 'cancelled' }
const sessions = new WeakMap<Viewer, DrawSession>()

/** One cancellable gesture. It owns temporary geometry, never project history. */
export class DrawSession {
  readonly result: Promise<DrawResult>
  private resolve!: (result: DrawResult) => void
  private readonly input: ScreenSpaceEventHandler
  private readonly keyTarget: Window | null
  private points: Cartesian3[] = []
  private preview?: Entity
  private active = true
  readonly minimum: number

  constructor(private readonly viewer: Viewer, private readonly options: DrawOptions) {
    if (viewer.isDestroyed()) throw new Error('Viewer 已销毁')
    if (!['point','polyline','polygon'].includes(options.type)) throw new Error('不支持的绘制类型')
    const definition: GraphicNode = {
      id: options.id ?? 'draw', name: options.name ?? options.type, type: 'graphic', visible: true,
      geometry: { type: options.type, heightMode: options.heightMode ?? 'ground', positions: options.type === 'point' ? [[0,0,0]] : options.type === 'polyline' ? [[0,0,0],[1,0,0]] : [[0,0,0],[1,0,0],[0,1,0]] },
      style: { color: '#3b796a', width: 3, pointSize: 10, ...options.style }, properties: options.properties ?? {}
    }
    if (!validateGraphic(definition)) throw new Error('绘制参数无效')
    this.options = structuredClone({ ...options, onChange: undefined })
    this.options.onChange = options.onChange
    sessions.get(viewer)?.cancel()
    this.minimum = options.type === 'point' ? 1 : options.type === 'polyline' ? 2 : 3
    this.result = new Promise(resolve => { this.resolve = resolve })
    this.input = new ScreenSpaceEventHandler(viewer.canvas)
    this.keyTarget = viewer.canvas.ownerDocument?.defaultView ?? null
    this.input.setInputAction((event: { position: Cartesian2 }) => {
      const point = this.pick(event.position)
      if (!point || this.points.some(previous => Cartesian3.equalsEpsilon(previous, point, 0, .01))) return
      this.points.push(Cartesian3.clone(point))
      this.updatePreview()
      options.onChange?.(this.count)
      if (options.type === 'point') this.finish()
    }, ScreenSpaceEventType.LEFT_CLICK)
    this.input.setInputAction((event: { endPosition: Cartesian2 }) => { const point = this.pick(event.endPosition); if (point) this.updatePreview(point) }, ScreenSpaceEventType.MOUSE_MOVE)
    this.input.setInputAction(() => this.finish(), ScreenSpaceEventType.RIGHT_CLICK)
    this.keyTarget?.addEventListener('keydown', this.handleKey, true)
    this.keyTarget?.addEventListener('blur', this.cancel)
    sessions.set(viewer, this)
  }
  get count(): number { return this.points.length }
  get isActive(): boolean { return this.active }
  private pick(position: Cartesian2): Cartesian3 | undefined {
    if (!this.active || this.viewer.isDestroyed()) return
    if (this.options.heightMode === 'absolute' && this.viewer.scene.pickPositionSupported) {
      const picked = this.viewer.scene.pickPosition(position)
      if (picked) return picked
    }
    const ray = this.viewer.camera.getPickRay(position)
    return (ray && this.viewer.scene.globe.pick(ray, this.viewer.scene)) || this.viewer.camera.pickEllipsoid(position)
  }
  private updatePreview(cursor?: Cartesian3): void {
    if (!this.active || this.viewer.isDestroyed()) return
    const positions = cursor && this.points.length ? [...this.points, cursor] : [...this.points]
    if (!positions.length) {
      if (this.preview) this.viewer.entities.remove(this.preview)
      this.preview = undefined
      this.viewer.scene.requestRender()
      return
    }
    const color = Color.fromCssColorString(this.options.style?.color ?? '#3b796a')
    this.preview ??= this.viewer.entities.add({ point: { pixelSize: 7, color, heightReference: this.options.heightMode === 'absolute' ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND }, polyline: { positions: [], width: 3, material: color, clampToGround: this.options.heightMode !== 'absolute' }, polygon: { hierarchy: new PolygonHierarchy([]), material: color.withAlpha(.18), perPositionHeight: this.options.heightMode === 'absolute' } })
    this.preview.position = new ConstantPositionProperty(positions.at(-1))
    if (this.preview.polyline) this.preview.polyline.positions = new ConstantProperty(this.options.type === 'polygon' && positions.length >= 3 ? [...positions, positions[0]] : positions)
    if (this.preview.polygon) { this.preview.polygon.show = new ConstantProperty(this.options.type === 'polygon' && positions.length >= 3); this.preview.polygon.hierarchy = new ConstantProperty(new PolygonHierarchy(positions)) }
    this.viewer.scene.requestRender()
  }
  finish = (): boolean => {
    if (!this.active || this.count < this.minimum) return false
    const positions: GeoPosition[] = this.points.map(point => { const p = Cartographic.fromCartesian(point); return [CesiumMath.toDegrees(p.longitude), CesiumMath.toDegrees(p.latitude), p.height] })
    const graphic: GraphicNode = {
      id: this.options.id ?? `graphic-${crypto.randomUUID()}`, name: this.options.name ?? this.options.type, type: 'graphic', visible: true,
      geometry: { type: this.options.type, positions, heightMode: this.options.heightMode ?? 'ground' },
      style: { color: '#3b796a', width: 3, pointSize: 10, ...this.options.style }, properties: structuredClone(this.options.properties ?? {})
    }
    if (!validateGraphic(graphic)) return false
    this.release(); this.resolve({ status: 'completed', graphic }); return true
  }
  cancel = (): void => { if (!this.active) return; this.release(); this.resolve({ status: 'cancelled' }) }
  destroy(): void { this.cancel() }
  private handleKey = (event: KeyboardEvent): void => {
    const target = event.target
    if (target instanceof Element && target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"]')) return
    if (event.key === 'Escape') { event.preventDefault(); this.cancel() }
    if (event.key === 'Enter') { event.preventDefault(); this.finish() }
    if (event.key === 'Backspace' && this.points.length) { event.preventDefault(); this.points.pop(); this.updatePreview(); this.options.onChange?.(this.count) }
  }
  private release(): void {
    this.active = false
    this.input.destroy()
    this.keyTarget?.removeEventListener('keydown', this.handleKey, true)
    this.keyTarget?.removeEventListener('blur', this.cancel)
    if (!this.viewer.isDestroyed()) { if (this.preview) this.viewer.entities.remove(this.preview); this.viewer.scene.requestRender() }
    this.preview = undefined
    if (sessions.get(this.viewer) === this) sessions.delete(this.viewer)
  }
}
