interface WorkspaceDraft {
  nextStep: string
  isPending(): boolean
}

const drafts = new Map<symbol, WorkspaceDraft>()

/** 登记尚未应用到项目的交互草稿，并保留完成或取消的操作提示。 */
export function registerWorkspaceDraft(nextStep: string, isPending = () => true): () => void {
  const key = Symbol()
  drafts.set(key, { nextStep, isPending })
  return () => { drafts.delete(key) }
}

function findPendingDraft(): WorkspaceDraft | undefined {
  for (const draft of drafts.values()) if (draft.isPending()) return draft
}

export function hasWorkspaceDrafts(): boolean { return findPendingDraft() !== undefined }

export function assertNoWorkspaceDrafts(): void {
  const draft = findPendingDraft()
  if (draft) throw new Error(draft.nextStep)
}
