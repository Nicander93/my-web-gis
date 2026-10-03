import { useEffect, useRef, useState } from 'react'
import { Cartesian2, Cartographic, Color, ConstantProperty, Math as CesiumMath, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium'
import type { Cartesian3, Entity, Viewer } from 'cesium'
import type { GeoPosition } from '@desktop-webgis/cesium-scene-schema'

/** Only completion writes a command; cancellation removes all temporary geometry. */
export function useWaterDrawing(viewer: Viewer | undefined, onComplete: (boundary: GeoPosition[], id?: string) => void, onEnd: () => void) {
  const [drawing, setDrawing] = useState(false)
  const [count, setCount] = useState(0)
  const handler = useRef<ScreenSpaceEventHandler | undefined>(undefined)
  const preview = useRef<Entity | undefined>(undefined)
  const points = useRef<Cartesian3[]>([])
  const objectId = useRef<string | undefined>(undefined)
  const complete = useRef(onComplete)
  const end = useRef(onEnd)
  complete.current = onComplete; end.current = onEnd

  function cancel(): void {
    handler.current?.destroy(); handler.current = undefined
    if (viewer && !viewer.isDestroyed() && preview.current) viewer.entities.remove(preview.current)
    preview.current = undefined; points.current = []
    setCount(0); setDrawing(false); end.current()
  }
  function finish(): void {
    if (points.current.length < 3) return
    const boundary = points.current.map(point => {
      const p = Cartographic.fromCartesian(point)
      return [CesiumMath.toDegrees(p.longitude), CesiumMath.toDegrees(p.latitude), p.height] as GeoPosition
    })
    const id = objectId.current
    cancel(); complete.current(boundary, id)
  }
  function start(id?: string): void {
    if (!viewer || viewer.isDestroyed()) return
    cancel(); objectId.current = id; setDrawing(true)
    const input = new ScreenSpaceEventHandler(viewer.canvas)
    handler.current = input
    input.setInputAction((event: { position: Cartesian2 }) => {
      const ray = viewer.camera.getPickRay(event.position)
      const point = (ray && viewer.scene.globe.pick(ray, viewer.scene)) || viewer.camera.pickEllipsoid(event.position)
      if (!point) return
      const previous = points.current.at(-1)
      if (previous && previous.equalsEpsilon(point, 0, .01)) return
      points.current.push(point); setCount(points.current.length)
      if (!preview.current) preview.current = viewer.entities.add({ polyline: { positions: [], width: 3, material: Color.fromCssColorString('#238baf') } })
      if (preview.current.polyline) preview.current.polyline.positions = new ConstantProperty(points.current.length > 2 ? [...points.current, points.current[0]] : [...points.current])
      viewer.scene.requestRender()
    }, ScreenSpaceEventType.LEFT_CLICK)
    input.setInputAction(finish, ScreenSpaceEventType.RIGHT_CLICK)
  }
  useEffect(() => {
    if (!drawing) return
    function handleKey(event: KeyboardEvent): void {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key === 'Escape') { event.preventDefault(); cancel() }
      if (event.key === 'Enter') { event.preventDefault(); finish() }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => window.removeEventListener('keydown', handleKey, true)
  }, [drawing, viewer])
  useEffect(() => () => {
    handler.current?.destroy()
    if (viewer && !viewer.isDestroyed() && preview.current) viewer.entities.remove(preview.current)
  }, [viewer])
  return { drawing, count, start, finish, cancel }
}
