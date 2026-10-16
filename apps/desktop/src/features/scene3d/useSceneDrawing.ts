import { useEffect, useRef, useState } from 'react'
import type { CesiumSceneRuntime } from '@desktop-webgis/cesium-scene-runtime'
import type { GraphicNode, GraphicType } from '@desktop-webgis/cesium-scene-schema'
import { createBillboardStyle } from '@desktop-webgis/cesium-scene-schema'
import type { SceneMeasurementKind } from '@desktop-webgis/cesium-measure'

export type SceneDrawKind = GraphicType | 'billboard' | 'water' | 'clip' | 'flatten' | SceneMeasurementKind
export function isContinuousDraw(kind: SceneDrawKind | null): boolean { return kind === 'point' || kind === 'billboard' }

/** The core owns Cesium input; React only subscribes and commits completion. */
export function useSceneDrawing(runtime: CesiumSceneRuntime | undefined, onComplete: (graphic: GraphicNode, kind: SceneDrawKind, id?: string) => void, onError: (reason: unknown) => void, onCancel: () => void, scope: number, readScope: () => number) {
  const [kind, setKind] = useState<SceneDrawKind | null>(null)
  const [count, setCount] = useState(0)
  const session = useRef<ReturnType<CesiumSceneRuntime['startDraw']> | undefined>(undefined)
  const intent = useRef<{ kind: SceneDrawKind; id?: string } | undefined>(undefined)
  const generation = useRef(0)
  const owner = useRef({ runtime, scope })
  owner.current = { runtime, scope }
  const complete = useRef(onComplete), error = useRef(onError)
  const cancelled = useRef(onCancel)
  complete.current = onComplete; error.current = onError
  cancelled.current = onCancel

  function cancel(): void { generation.current++; intent.current = undefined; const previous = session.current; session.current = undefined; previous?.cancel(); setKind(null); setCount(0) }
  function begin(next: SceneDrawKind, id?: string): void {
    if (!runtime || session.current) return
    const version = ++generation.current
    const isCurrent = () => generation.current === version && owner.current.runtime === runtime && owner.current.scope === scope && readScope() === scope
    try {
      const polygon = next === 'water' || next === 'clip' || next === 'flatten' || next === 'area'
      const measurement = ['spatial-distance', 'ground-distance', 'area', 'height-difference'].includes(next)
      const type: GraphicType = polygon ? 'polygon' : measurement ? 'polyline' : next === 'billboard' ? 'point' : next as GraphicType
      const drawing = runtime.startDraw({
        type,
        ...(next === 'billboard' ? { style: { billboard: createBillboardStyle() } } : {}),
        heightMode: next === 'clip' || next === 'flatten' || measurement ? 'absolute' : 'ground',
        onChange: count => { if (isCurrent()) setCount(count) },
        onInvalid: message => { if (isCurrent()) error.current(new Error(message)) }
      })
      session.current = drawing; setKind(next)
      void drawing.result.then(result => {
        if (!isCurrent() || session.current !== drawing) return
        session.current = undefined; setCount(0)
        if (result.status === 'completed') {
          if (!isContinuousDraw(next)) { intent.current = undefined; setKind(null) }
          complete.current(result.graphic, next, id)
        } else { intent.current = undefined; setKind(null); cancelled.current() }
      }).catch(reason => { if (isCurrent()) error.current(reason) })
    } catch (reason) { error.current(reason) }
  }
  function start(next: SceneDrawKind, id?: string): void { cancel(); intent.current = { kind: next, id }; begin(next, id) }
  /** Restarts a continuous point gesture after the previous point reaches the authoritative runtime. */
  function resume(): void { const next = intent.current; if (next && isContinuousDraw(next.kind)) begin(next.kind, next.id) }
  function finish(): void { session.current?.finish() }
  useEffect(() => () => cancel(), [runtime, scope])
  const minimum = isContinuousDraw(kind) ? 1 : kind === 'rectangle' || kind === 'ellipse' || kind === 'polyline' || kind === 'spatial-distance' || kind === 'ground-distance' || kind === 'height-difference' ? 2 : 3
  return { kind, count, drawing: kind !== null, minimum, start, resume, finish, cancel }
}
