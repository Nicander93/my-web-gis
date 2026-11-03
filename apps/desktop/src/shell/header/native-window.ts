export type UnsavedCloseChoice = 'save' | 'discard' | 'cancel'

export interface MaximizedWindow {
  isMaximized(): Promise<boolean>
  onResized(handler: () => void): Promise<() => void>
}

export interface WindowCloseHost {
  projectEpoch(): number
  contentVersion(): number
  hasDirtyDrafts(): boolean
  resolveDrafts(): Promise<boolean>
  isProjectDirty(): boolean
  confirmUnsaved(): Promise<UnsavedCloseChoice>
  saveProject(): Promise<boolean>
  discardRecovery(): Promise<void>
}

/** Keep the title-bar maximize icon aligned with OS changes; ignore stale replies after unmount. */
export function subscribeMaximized(
  appWindow: MaximizedWindow,
  onChange: (maximized: boolean) => void,
  onError: (error: unknown) => void
): () => void {
  let disposed = false
  let revision = 0
  const update = () => {
    const request = ++revision
    void appWindow.isMaximized().then((value) => {
      if (!disposed && request === revision) onChange(value)
    }).catch((error: unknown) => {
      if (!disposed) onError(error)
    })
  }
  const listener = appWindow.onResized(update)
  void listener.then(update).catch((error: unknown) => {
    if (!disposed) onError(error)
  })
  return () => {
    disposed = true
    void listener.then((unlisten) => unlisten()).catch(() => {})
  }
}

/**
 * Native close requests share one decision. A later request waits for the same
 * answer instead of opening another dialog.
 */
export function createCloseSession(decide: () => Promise<boolean>): { request(): Promise<boolean> } {
  let inflight: Promise<boolean> | null = null
  return {
    request() {
      if (inflight) return inflight
      inflight = decide().finally(() => { inflight = null })
      return inflight
    }
  }
}

/** Drafts first, then unsaved project; save must still be clean afterwards. */
export async function allowWindowClose(host: WindowCloseHost): Promise<boolean> {
  const epoch = host.projectEpoch()
  if (host.hasDirtyDrafts() && !await host.resolveDrafts()) return false
  if (host.projectEpoch() !== epoch || host.hasDirtyDrafts()) return false
  if (!host.isProjectDirty()) return true
  const version = host.contentVersion()
  const unchanged = () => host.projectEpoch() === epoch && host.contentVersion() === version && !host.hasDirtyDrafts()
  const choice = await host.confirmUnsaved()
  if (!unchanged()) return false
  if (choice === 'cancel') return false
  if (choice === 'discard') {
    await host.discardRecovery()
    return unchanged()
  }
  if (host.isProjectDirty()) {
    const saved = await host.saveProject()
    if (!saved || host.isProjectDirty()) return false
  }
  return unchanged() && !host.isProjectDirty()
}
