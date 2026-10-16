import { useEffect, useRef, useState } from 'react'
import type { CesiumSceneRuntime, EditState, GraphicEditResult } from '@desktop-webgis/cesium-scene-runtime'
import type { GeoPosition } from '@desktop-webgis/cesium-scene-schema'

/** React observes the core session; project history receives only its completed result. */
export function useSceneGraphicEditing(runtime: CesiumSceneRuntime | undefined, onComplete: (result: Extract<GraphicEditResult, { status: 'completed' }>) => void, onError: (reason: unknown) => void, onCancel: () => void, scope: number, readScope: () => number) {
  const [state, setState] = useState<EditState | null>(null)
  const session = useRef<ReturnType<CesiumSceneRuntime['startGraphicEditing']> | undefined>(undefined)
  const callbacks = useRef({ onComplete, onError, onCancel })
  const generation = useRef(0)
  const owner = useRef({ runtime, scope })
  owner.current = { runtime, scope }
  callbacks.current = { onComplete, onError, onCancel }
  function cancel(): void { generation.current++; const current = session.current; session.current = undefined; current?.cancel(); setState(null) }
  function start(id: string): void {
    if (!runtime) return
    cancel()
    const version = ++generation.current
    const isCurrent = () => generation.current === version && owner.current.runtime === runtime && owner.current.scope === scope && readScope() === scope
    try {
      const editing = runtime.startGraphicEditing(id, { onChange: state => { if (isCurrent()) setState(state) } })
      session.current = editing; setState(editing.state)
      void editing.result.then(result => {
        if (!isCurrent() || session.current !== editing) return
        session.current = undefined; setState(null)
        if (result.status === 'completed') callbacks.current.onComplete(result)
        else callbacks.current.onCancel()
      }).catch(reason => { if (isCurrent()) callbacks.current.onError(reason) })
    } catch (reason) { callbacks.current.onError(reason) }
  }
  function invoke(action: (editing: NonNullable<typeof session.current>) => void): void {
    if (!session.current) return
    try { action(session.current) } catch (reason) { callbacks.current.onError(reason) }
  }
  useEffect(() => () => cancel(), [runtime, scope])
  return { state, active: state !== null, start, cancel, finish: () => invoke(editing => { editing.finish() }),
    selectVertex: (index: number) => invoke(editing => editing.selectVertex(index)),
    setPosition: (index: number, position: GeoPosition) => invoke(editing => editing.setVertexPosition(index, position)),
    insertVertex: (index: number) => invoke(editing => editing.insertVertex(index)),
    removeVertex: (index: number) => invoke(editing => { editing.removeVertex(index) }) }
}
