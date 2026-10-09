import type { SceneDocument } from '@desktop-webgis/scene-schema'
import type { SceneController } from './controller.js'

export interface SceneDocumentRuntime {
  /** Abort must prevent an obsolete operation from publishing native content. */
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
  /** Waits for the newest requested revision, including replacements made while waiting. */
  settled(): Promise<SceneRuntimeSyncState>
  /** Retry projection of the authoritative document without creating a content edit. */
  refresh(): void
  /** Unsubscribes and cancels this binding's work; controller and runtime remain host-owned. */
  dispose(): void
}

/** Projects controller commits without giving rendering failures ownership of document content. */
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
    // Run after synchronous controller observers have completed; no projection writes inside a commit.
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
