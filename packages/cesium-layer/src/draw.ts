import { Cartesian3, Cartographic, Color, ConstantPositionProperty, ConstantProperty, EllipseGraphics, RectangleGraphics, HeightReference, Math as CesiumMath, PolygonHierarchy, ScreenSpaceEventHandler, ScreenSpaceEventType, VerticalOrigin } from 'cesium'
import type { Cartesian2, Entity, Viewer } from 'cesium'
import type { GeoPosition, GraphicNode, GraphicStyle, GraphicType } from '@desktop-webgis/cesium-scene-schema'
import { graphicMinimum, isParametricGraphic, validateGraphic } from '@desktop-webgis/cesium-scene-schema'
import { claimInteraction, releaseInteraction } from './interaction.js'
import { parametricGraphic } from './parametric-graphic.js'

export interface DrawOptions {
  type: GraphicType
  id?: string
  name?: string
  heightMode?: 'ground' | 'absolute'
  style?: Partial<GraphicStyle>
  properties?: Record<string, unknown>
  onChange?: (count: number) => void
  onInvalid?: (message: string) => void
}
export type DrawResult = { status: 'completed'; graphic: GraphicNode } | { status: 'cancelled' }

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
    if (!['point','polyline','polygon','rectangle','ellipse'].includes(options.type)) throw new Error('不支持的绘制类型')
    const definition: GraphicNode = {
      id: options.id ?? 'draw', name: options.name ?? options.type, type: 'graphic', visible: true,
      geometry: { type: options.type, heightMode: options.heightMode ?? 'ground', positions: options.type === 'point' ? [[0,0,0]] : options.type === 'polyline' ? [[0,0,0],[1,0,0]] : isParametricGraphic(options.type) ? [[0,0,0],[1,1,0]] : [[0,0,0],[1,0,0],[0,1,0]] },
      style: { color: '#3b796a', width: 3, pointSize: 10, ...options.style }, properties: options.properties ?? {}
    }
    if (!validateGraphic(definition)) throw new Error('绘制参数无效')
    this.options = structuredClone({ ...options, onChange: undefined, onInvalid: undefined })
    this.options.onChange = options.onChange
    this.options.onInvalid = options.onInvalid
    this.minimum = graphicMinimum(options.type)
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
      if (isParametricGraphic(options.type) && this.count === 2 && !this.finish()) { this.points.pop(); this.updatePreview(); options.onChange?.(this.count) }
    }, ScreenSpaceEventType.LEFT_CLICK)
    this.input.setInputAction((event: { endPosition: Cartesian2 }) => { const point = this.pick(event.endPosition); if (point) this.updatePreview(point) }, ScreenSpaceEventType.MOUSE_MOVE)
    this.input.setInputAction(() => this.finish(), ScreenSpaceEventType.RIGHT_CLICK)
    this.keyTarget?.addEventListener('keydown', this.handleKey, true)
    this.keyTarget?.addEventListener('blur', this.cancel)
    claimInteraction(viewer, this)
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
    const positions = cursor && (this.points.length || this.options.style?.billboard) ? [...this.points, cursor] : [...this.points]
    if (!positions.length) {
      if (this.preview) this.viewer.entities.remove(this.preview)
      this.preview = undefined
      this.viewer.scene.requestRender()
      return
    }
    const color = Color.fromCssColorString(this.options.style?.color ?? '#3b796a')
    const heightReference = this.options.heightMode === 'absolute' ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND
    const geographic: GeoPosition[] = positions.slice(0,2).map(point => { const p = Cartographic.fromCartesian(point); return [CesiumMath.toDegrees(p.longitude),CesiumMath.toDegrees(p.latitude),p.height] })
    const shape = isParametricGraphic(this.options.type) ? parametricGraphic({ type: this.options.type, positions: geographic, heightMode: this.options.heightMode ?? 'ground' }) : undefined
    this.preview ??= this.viewer.entities.add({ point: this.options.style?.billboard ? undefined : { pixelSize: 7, color, heightReference }, billboard: this.options.style?.billboard ? { ...this.options.style.billboard, heightReference, verticalOrigin: VerticalOrigin.BOTTOM } : undefined, polyline: { positions: [], width: 3, material: color, clampToGround: this.options.heightMode !== 'absolute' }, polygon: { hierarchy: new PolygonHierarchy([]), material: color.withAlpha(.18), perPositionHeight: this.options.heightMode === 'absolute' } })
    if (this.options.type === 'rectangle' && !this.preview.rectangle) this.preview.rectangle = new RectangleGraphics({ show: false, material: color.withAlpha(.18), heightReference })
    if (this.options.type === 'ellipse' && !this.preview.ellipse) this.preview.ellipse = new EllipseGraphics({ show: false, material: color.withAlpha(.18), heightReference })
    if (this.preview.rectangle) {
      this.preview.rectangle.show = new ConstantProperty(Boolean(shape?.rectangle))
      if (shape?.rectangle) { this.preview.rectangle.coordinates = new ConstantProperty(shape.rectangle); this.preview.rectangle.height = new ConstantProperty(this.options.heightMode === 'absolute' ? geographic[0][2] : 0) }
    }
    if (this.preview.ellipse) {
      this.preview.ellipse.show = new ConstantProperty(Boolean(shape?.ellipse))
      if (shape?.ellipse) { this.preview.ellipse.semiMajorAxis = new ConstantProperty(shape.ellipse.semiMajorAxis); this.preview.ellipse.semiMinorAxis = new ConstantProperty(shape.ellipse.semiMinorAxis); this.preview.ellipse.rotation = new ConstantProperty(shape.ellipse.rotation); this.preview.ellipse.height = new ConstantProperty(this.options.heightMode === 'absolute' ? geographic[0][2] : 0) }
    }
    if (this.preview.polyline) this.preview.polyline.show = new ConstantProperty(!isParametricGraphic(this.options.type))
    this.preview.position = new ConstantPositionProperty(shape?.position ?? positions.at(-1))
    if (this.preview.polyline) this.preview.polyline.positions = new ConstantProperty(this.options.type === 'polygon' && positions.length >= 3 ? [...positions, positions[0]] : positions)
    if (this.preview.polygon) { this.preview.polygon.show = new ConstantProperty(this.options.type === 'polygon' && positions.length >= 3); this.preview.polygon.hierarchy = new ConstantProperty(new PolygonHierarchy(positions)) }
    this.viewer.scene.requestRender()
  }
  finish = (): boolean => {
    if (!this.active || this.count < this.minimum) return false
    const positions: GeoPosition[] = this.points.map(point => { const p = Cartographic.fromCartesian(point); return [CesiumMath.toDegrees(p.longitude), CesiumMath.toDegrees(p.latitude), p.height] })
    if (isParametricGraphic(this.options.type)) positions.forEach(position => { position[2] = positions[0][2] })
    const graphic: GraphicNode = {
      id: this.options.id ?? `graphic-${crypto.randomUUID()}`, name: this.options.name ?? this.options.type, type: 'graphic', visible: true,
      geometry: { type: this.options.type, positions, heightMode: this.options.heightMode ?? 'ground' },
      style: { color: '#3b796a', width: 3, pointSize: 10, ...this.options.style }, properties: structuredClone(this.options.properties ?? {})
    }
    if (!validateGraphic(graphic)) {
      if (isParametricGraphic(this.options.type)) this.options.onInvalid?.('范围无效：两个对角点须有非零经纬差，不能跨日期变更线；椭圆跨度不超过 10°，纬度在 ±85° 内。请重新选择第二点。')
      return false
    }
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
    releaseInteraction(this.viewer, this)
  }
}
