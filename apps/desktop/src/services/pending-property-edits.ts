const pending = new Set<symbol>()

/** Modeless form edits are not yet part of the persisted project. */
export function registerPendingPropertyEdit(): () => void {
  const key = Symbol()
  pending.add(key)
  return () => { pending.delete(key) }
}

export function hasPendingPropertyEdits(): boolean { return pending.size > 0 }
