import { Cartesian2, Cartesian3, Color, Entity, IntersectionTests, Matrix4, Plane, ScreenSpaceEventHandler, ScreenSpaceEventType, Transforms } from 'cesium'
import type { Viewer } from 'cesium'
import type { TransformLayer } from '@desktop-webgis/cesium-layer'
import type { Transform } from '@desktop-webgis/cesium-scene-schema'

export type EditMode = 'translate' | 'rotate' | 'scale'
type Axis = 'X' | 'Y' | 'Z' | 'XY' | 'S'
export interface TransformEditEvent { id: string; before: Transform; after: Transform }
export interface TilesetEditorOptions {
  mode?: EditMode
  translationSnap?: number
  rotationSnap?: number
  onStart?: () => void
  onPreview?: (event: TransformEditEvent) => void
  onCommit?: (event: TransformEditEvent) => void
  onCancel?: () => void
}
interface Drag {
  axis: Axis
  before: Transform
  pixel: Cartesian2
  origin: Cartesian3
  basis: Cartesian3[]
  plane: Plane
  start: Cartesian3
  cameraInputs: boolean
}

/** Ray/plane-constrained transform handles for both tilesets and glTF models. */
export class TilesetEditor {
  private layer?: TransformLayer
  private handles: Entity[] = []
  private readonly axes = new Map<Entity, Axis>()
  private readonly handler: ScreenSpaceEventHandler
  private drag?: Drag
  private destroyed = false
  private readonly keyHandler = (event: KeyboardEvent) => { if (event.key === 'Escape') { this.cancel(); event.preventDefault() } }
  private readonly blurHandler = () => this.cancel()
  private readonly upHandler = () => this.commit()
  mode: EditMode

  constructor(private readonly viewer: Viewer, private readonly options: TilesetEditorOptions = {}) {
    this.mode = options.mode ?? 'translate'
    this.handler = new ScreenSpaceEventHandler(viewer.canvas)
    this.handler.setInputAction((event: { position: Cartesian2 }) => this.begin(event.position), ScreenSpaceEventType.LEFT_DOWN)
    this.handler.setInputAction((event: { endPosition: Cartesian2 }) => this.move(event.endPosition), ScreenSpaceEventType.MOUSE_MOVE)
    this.handler.setInputAction(() => this.commit(), ScreenSpaceEventType.LEFT_UP)
    window.addEventListener('keydown', this.keyHandler)
    window.addEventListener('blur', this.blurHandler)
    window.addEventListener('pointerup', this.upHandler)
  }

  startEditing(layer: TransformLayer): void {
    if (this.destroyed) throw new Error('TilesetEditor 已销毁')
    this.stopEditing()
    if (!layer.pivot || !layer.boundingSphere) throw new Error('请等待模型加载完成后再编辑')
    this.layer = layer
    this.drawHandles()
  }
  setMode(mode: EditMode): void { this.cancel(); this.mode = mode; this.drawHandles() }
  refresh(): void { if (!this.drag) this.drawHandles() }
  stopEditing(): void { this.cancel(); this.layer = undefined; this.clearHandles() }
  destroy(): void {
    if (this.destroyed) return
    this.stopEditing(); this.destroyed = true
    this.handler.destroy()
    window.removeEventListener('keydown', this.keyHandler)
    window.removeEventListener('blur', this.blurHandler)
    window.removeEventListener('pointerup', this.upHandler)
  }

  cancel(): void {
    if (!this.drag) return
    const drag = this.drag
    this.drag = undefined
    this.layer?.setTransform(drag.before)
    this.restoreCamera(drag)
    this.drawHandles()
    this.options.onCancel?.()
  }

  commit(): void {
    if (!this.drag || !this.layer) return
    const drag = this.drag, after = this.layer.getTransform()
    this.drag = undefined
    this.restoreCamera(drag)
    this.drawHandles()
    if (JSON.stringify(drag.before) !== JSON.stringify(after)) this.options.onCommit?.({ id: this.layer.id, before: drag.before, after })
    else this.options.onCancel?.()
  }

  private restoreCamera(drag: Drag): void {
    if (!this.viewer.isDestroyed()) this.viewer.scene.screenSpaceCameraController.enableInputs = drag.cameraInputs
  }
  private clearHandles(): void {
    if (!this.viewer.isDestroyed()) this.handles.forEach(entity => this.viewer.entities.remove(entity))
    this.handles = []; this.axes.clear()
  }

  private getFrame(): { origin: Cartesian3; basis: Cartesian3[] } | undefined {
    if (!this.layer?.pivot) return
    const frame = Transforms.eastNorthUpToFixedFrame(this.layer.pivot)
    const origin = Matrix4.multiplyByPoint(frame, Cartesian3.fromArray(this.layer.getTransform().translation), new Cartesian3())
    const basis = [Cartesian3.UNIT_X, Cartesian3.UNIT_Y, Cartesian3.UNIT_Z].map(axis => Matrix4.multiplyByPointAsVector(frame, axis, new Cartesian3()))
    return { origin, basis }
  }

  private drawHandles(): void {
    this.clearHandles()
    const frame = this.getFrame()
    if (!frame || this.viewer.isDestroyed()) return
    const { origin, basis } = frame
    const radius = Math.max(10, Math.min(this.layer?.boundingSphere?.radius ?? 30, 250))
    const colors = [Color.fromCssColorString('#ff665e'), Color.fromCssColorString('#71d98a'), Color.fromCssColorString('#68b5ff')]
    const point = (x: number, y: number, z: number): Cartesian3 => {
      const result = Cartesian3.clone(origin)
      ;[x, y, z].forEach((value, i) => Cartesian3.add(result, Cartesian3.multiplyByScalar(basis[i], value * radius, new Cartesian3()), result))
      return result
    }
    const add = (axis: Axis, positions: Cartesian3[], color: Color): void => {
      const entity = this.viewer.entities.add({ polyline: { positions, width: 5, material: color, depthFailMaterial: color.withAlpha(0.5) } })
      this.handles.push(entity); this.axes.set(entity, axis)
    }
    if (this.mode === 'translate') {
      ;(['X', 'Y', 'Z'] as const).forEach((axis, i) => add(axis, [origin, point(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0)], colors[i]))
      add('XY', [point(.2,.2,0), point(.45,.2,0), point(.45,.45,0), point(.2,.45,0), point(.2,.2,0)], Color.YELLOW)
    } else if (this.mode === 'rotate') {
      ;(['X', 'Y', 'Z'] as const).forEach((axis, i) => {
        const points = Array.from({ length: 65 }, (_, n) => {
          const angle = n * Math.PI / 32, p = [0, 0, 0]
          p[(i + 1) % 3] = Math.cos(angle); p[(i + 2) % 3] = Math.sin(angle)
          return point(p[0], p[1], p[2])
        })
        add(axis, points, colors[i])
      })
    } else add('S', [origin, point(.7,.7,.7)], Color.WHITE)
    this.viewer.scene.requestRender()
  }

  private begin(pixel: Cartesian2): void {
    if (this.drag || !this.layer || !this.getFrame()) return
    const picked: unknown = this.viewer.scene.pick(pixel)
    if (!picked || typeof picked !== 'object' || !('id' in picked) || !(picked.id instanceof Entity)) return
    const axis = this.axes.get(picked.id)
    const frame = this.getFrame()
    if (!axis || !frame) return
    const { origin, basis } = frame
    const index = axis === 'X' ? 0 : axis === 'Y' ? 1 : 2
    let normal = basis[2]
    if (axis !== 'XY' && axis !== 'S') {
      normal = this.mode === 'rotate' ? basis[index] : Cartesian3.subtract(this.viewer.camera.directionWC, Cartesian3.multiplyByScalar(basis[index], Cartesian3.dot(this.viewer.camera.directionWC, basis[index]), new Cartesian3()), new Cartesian3())
      if (Cartesian3.magnitudeSquared(normal) < 1e-8) return
      Cartesian3.normalize(normal, normal)
    }
    const plane = new Plane(normal, -Cartesian3.dot(normal, origin))
    const ray = this.viewer.camera.getPickRay(pixel)
    const start = ray ? IntersectionTests.rayPlane(ray, plane) : undefined
    if (!start && this.mode !== 'scale') return
    this.drag = { axis, before: this.layer.getTransform(), pixel: Cartesian2.clone(pixel), origin, basis, plane, start: start ?? origin, cameraInputs: this.viewer.scene.screenSpaceCameraController.enableInputs }
    this.viewer.scene.screenSpaceCameraController.enableInputs = false
    this.options.onStart?.()
  }

  private move(pixel: Cartesian2): void {
    if (!this.drag || !this.layer) return
    const drag = this.drag, next = structuredClone(drag.before)
    const ray = this.viewer.camera.getPickRay(pixel)
    const hit = ray ? IntersectionTests.rayPlane(ray, drag.plane) : undefined
    const axisIndex = drag.axis === 'X' ? 0 : drag.axis === 'Y' ? 1 : 2
    if (this.mode === 'translate' && hit) {
      const delta = Cartesian3.subtract(hit, drag.start, new Cartesian3())
      for (let i = 0; i < 3; i++) {
        if (drag.axis === 'XY' ? i === 2 : i !== axisIndex) continue
        const distance = snap(Cartesian3.dot(delta, drag.basis[i]), this.options.translationSnap)
        next.translation[i] += distance
      }
    } else if (this.mode === 'rotate' && hit) {
      const a = Cartesian3.subtract(drag.start, drag.origin, new Cartesian3()), b = Cartesian3.subtract(hit, drag.origin, new Cartesian3())
      if (Cartesian3.magnitudeSquared(a) < 1e-8 || Cartesian3.magnitudeSquared(b) < 1e-8) return
      const angle = Math.atan2(Cartesian3.dot(Cartesian3.cross(a, b, new Cartesian3()), drag.basis[axisIndex]), Cartesian3.dot(a, b)) * 180 / Math.PI
      // Cesium HPR uses +roll around X, -pitch around Y, -heading around Z.
      next.rotation[[2, 1, 0][axisIndex]] += snap(angle * (axisIndex === 0 ? 1 : -1), this.options.rotationSnap)
    } else if (this.mode === 'scale') {
      next.scale = Math.max(.001, Math.min(10000, drag.before.scale * Math.exp(((pixel.x - drag.pixel.x) - (pixel.y - drag.pixel.y)) / 150)))
    } else return
    this.layer.setTransform(next)
    this.options.onPreview?.({ id: this.layer.id, before: drag.before, after: next })
  }
}

function snap(value: number, interval = 0): number { return interval > 0 ? Math.round(value / interval) * interval : value }
