const pending = new Map<symbol, string>()

/** 登记尚未应用到项目的交互草稿，并保留完成或取消的操作提示。 */
export function registerWorkspaceDraft(nextStep: string): () => void {
  const key = Symbol()
  pending.set(key, nextStep)
  return () => { pending.delete(key) }
}

export function hasWorkspaceDrafts(): boolean { return pending.size > 0 }

export function assertNoWorkspaceDrafts(): void {
  const message = pending.values().next().value
  if (message) throw new Error(message)
}
