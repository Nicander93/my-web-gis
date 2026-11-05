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

/** Keep the title-bar maximize icon aligned with OS changes; 忽略 stale replies after unmount. */
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
 * 多个原生关闭请求共用同一个决定；后到的请求会等待同一个
 * 直接在这里回答，不再打开另一个对话框。.
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

/** 先处理草稿，再处理未保存的项目；保存之后仍应保持干净状态。 */
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
