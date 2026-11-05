import type { SceneDocument } from '@desktop-webgis/scene-schema'
import type { SceneController } from './controller.js'

export interface SceneDocumentRuntime {
  /** 中止必须阻止已经过期的操作再发布原生内容。 */
  updateDocument(document: SceneDocument, signal: AbortSignal): void | Promise<void>
}
export interface SceneRuntimeSyncState {
  revision: number
  appliedRevision: number
  status: 'loading' | 'ready' | 'error' | 'disposed'
  error?: unknown
}
export interface SceneRuntimeBinding {
  getState(): SceneRuntimeSyncState
  /** 等待最新请求的那个修订，包括等待期间发生的替换。 */
  settled(): Promise<SceneRuntimeSyncState>
  /** 重新投影权威文档，但不产生一次内容编辑。 */
  refresh(): void
  /** 退订并取消这个绑定发起的任务；控制器和运行时仍然由宿主持有。 */
  dispose(): void
}

/** 投影控制器提交时，渲染失败不会波及文档内容。 */
export function bindSceneRuntime(controller: SceneController, runtime: SceneDocumentRuntime): SceneRuntimeBinding {
  let state: SceneRuntimeSyncState = { revision: 0, appliedRevision: 0, status: 'loading' }
  let operation: AbortController | null = null
  let pending = Promise.resolve()
  let disposed = false
  const waiters = new Set<() => void>()
  function synchronize(document: SceneDocument): void {
    if (disposed) return
    operation?.abort()
    const current = new AbortController(), revision = state.revision + 1
    operation = current
    state = { revision, appliedRevision: state.appliedRevision, status: 'loading' }
    // 在同步的控制器观察者执行完成之后再运行；提交过程中不写投影。
    pending = Promise.resolve().then(async () => {
      current.signal.throwIfAborted()
      await runtime.updateDocument(document, current.signal)
      current.signal.throwIfAborted()
      if (!disposed && revision === state.revision) state = { revision, appliedRevision: revision, status: 'ready' }
    }).catch(error => {
      if (!disposed && !current.signal.aborted && revision === state.revision) {
        state = { revision, appliedRevision: state.appliedRevision, status: 'error', error }
      }
    }).finally(() => { if (operation === current) operation = null })
    waiters.forEach(wake => wake())
  }
  const unsubscribe = controller.subscribe(change => synchronize(change.after))
  synchronize(controller.getDocument())
  return {
    getState: () => ({ ...state }),
    async settled() {
      while (!disposed) {
        const latest = pending
        let wake!: () => void
        const replaced = new Promise<void>(resolve => { wake = resolve; waiters.add(wake) })
        try { await Promise.race([latest, replaced]) }
        finally { waiters.delete(wake) }
        if (latest === pending) break
      }
      return { ...state }
    },
    refresh() { if (!disposed) synchronize(controller.getDocument()) },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      operation?.abort()
      operation = null
      state = { revision: state.revision, appliedRevision: state.appliedRevision, status: 'disposed' }
      waiters.forEach(wake => wake())
    }
  }
}
