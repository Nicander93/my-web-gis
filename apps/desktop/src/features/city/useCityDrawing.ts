import { useEffect, useRef, useState } from 'react'
import type { CitySceneRuntime } from '@desktop-webgis/cesium-scene-runtime'
import type { GraphicNode, GraphicType } from '@desktop-webgis/cesium-scene-schema'

export type CityDrawKind = GraphicType | 'water'

/** The core owns Cesium input; React only subscribes and commits completion. */
export function useCityDrawing(runtime: CitySceneRuntime | undefined, onComplete: (graphic: GraphicNode, kind: CityDrawKind, id?: string) => void, onError: (reason: unknown) => void, onCancel: () => void) {
  const [kind, setKind] = useState<CityDrawKind | null>(null)
  const [count, setCount] = useState(0)
  const session = useRef<ReturnType<CitySceneRuntime['startDraw']> | undefined>(undefined)
  const complete = useRef(onComplete), error = useRef(onError)
  const cancelled = useRef(onCancel)
  complete.current = onComplete; error.current = onError
  cancelled.current = onCancel

  function cancel(): void { session.current?.cancel(); session.current = undefined; setKind(null); setCount(0) }
  function start(next: CityDrawKind, id?: string): void {
    if (!runtime) return
    cancel()
    try {
      const drawing = runtime.startDraw({ type: next === 'water' ? 'polygon' : next, onChange: setCount })
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
  return { kind, count, drawing: kind !== null, minimum: kind === 'point' ? 1 : kind === 'polyline' ? 2 : 3, start, finish, cancel }
}
