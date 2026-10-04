import { useEffect, useRef, useState } from 'react'
import type { CitySceneRuntime, EditState, GraphicEditResult } from '@desktop-webgis/cesium-scene-runtime'
import type { GeoPosition } from '@desktop-webgis/cesium-scene-schema'

/** React observes the core session; project history receives only its completed result. */
export function useCityGraphicEditing(runtime: CitySceneRuntime | undefined, onComplete: (result: Extract<GraphicEditResult, { status: 'completed' }>) => void, onError: (reason: unknown) => void, onCancel: () => void) {
  const [state, setState] = useState<EditState | null>(null)
  const session = useRef<ReturnType<CitySceneRuntime['startGraphicEditing']> | undefined>(undefined)
  const callbacks = useRef({ onComplete, onError, onCancel })
  callbacks.current = { onComplete, onError, onCancel }
  function cancel(): void { const current = session.current; session.current = undefined; current?.cancel(); setState(null) }
  function start(id: string): void {
    if (!runtime) return
    cancel()
    try {
      const editing = runtime.startGraphicEditing(id, { onChange: setState })
      session.current = editing; setState(editing.state)
      void editing.result.then(result => {
        if (session.current !== editing) return
        session.current = undefined; setState(null)
        if (result.status === 'completed') callbacks.current.onComplete(result)
        else callbacks.current.onCancel()
      }).catch(reason => callbacks.current.onError(reason))
    } catch (reason) { callbacks.current.onError(reason) }
  }
  function invoke(action: (editing: NonNullable<typeof session.current>) => void): void {
    if (!session.current) return
    try { action(session.current) } catch (reason) { callbacks.current.onError(reason) }
  }
  useEffect(() => () => { session.current?.cancel(); session.current = undefined }, [runtime])
  return { state, active: state !== null, start, cancel, finish: () => invoke(editing => { editing.finish() }),
    selectVertex: (index: number) => invoke(editing => editing.selectVertex(index)),
    setPosition: (index: number, position: GeoPosition) => invoke(editing => editing.setVertexPosition(index, position)),
    insertVertex: (index: number) => invoke(editing => editing.insertVertex(index)),
    removeVertex: (index: number) => invoke(editing => { editing.removeVertex(index) }) }
}
