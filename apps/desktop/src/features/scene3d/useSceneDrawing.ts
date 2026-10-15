import { useEffect, useRef, useState } from 'react'
import type { CesiumSceneRuntime } from '@desktop-webgis/cesium-scene-runtime'
import type { GraphicNode, GraphicType } from '@desktop-webgis/cesium-scene-schema'
import type { SceneMeasurementKind } from '@desktop-webgis/cesium-measure'

export type SceneDrawKind = GraphicType | 'water' | 'clip' | 'flatten' | SceneMeasurementKind

/** The core owns Cesium input; React only subscribes and commits completion. */
export function useSceneDrawing(runtime: CesiumSceneRuntime | undefined, onComplete: (graphic: GraphicNode, kind: SceneDrawKind, id?: string) => void, onError: (reason: unknown) => void, onCancel: () => void) {
  const [kind, setKind] = useState<SceneDrawKind | null>(null)
  const [count, setCount] = useState(0)
  const session = useRef<ReturnType<CesiumSceneRuntime['startDraw']> | undefined>(undefined)
  const complete = useRef(onComplete), error = useRef(onError)
  const cancelled = useRef(onCancel)
  complete.current = onComplete; error.current = onError
  cancelled.current = onCancel

  function cancel(): void { session.current?.cancel(); session.current = undefined; setKind(null); setCount(0) }
  function start(next: SceneDrawKind, id?: string): void {
    if (!runtime) return
    cancel()
    try {
      const polygon = next === 'water' || next === 'clip' || next === 'flatten' || next === 'area'
      const measurement = ['spatial-distance', 'ground-distance', 'area', 'height-difference'].includes(next)
      const type: GraphicType = polygon ? 'polygon' : measurement ? 'polyline' : next as GraphicType
      const drawing = runtime.startDraw({
        type,
        heightMode: next === 'clip' || next === 'flatten' || measurement ? 'absolute' : 'ground',
        onChange: setCount
      })
      session.current = drawing; setKind(next)
      void drawing.result.then(result => {
        if (session.current !== drawing) return
        session.current = undefined; setKind(null); setCount(0)
        if (result.status === 'completed') complete.current(result.graphic, next, id)
        else cancelled.current()
      }).catch(error.current)
    } catch (reason) { error.current(reason) }
  }
  function finish(): void { session.current?.finish() }
  useEffect(() => () => { session.current?.cancel(); session.current = undefined }, [runtime])
  const minimum = kind === 'point' ? 1 : kind === 'polyline' || kind === 'spatial-distance' || kind === 'ground-distance' || kind === 'height-difference' ? 2 : 3
  return { kind, count, drawing: kind !== null, minimum, start, finish, cancel }
}
