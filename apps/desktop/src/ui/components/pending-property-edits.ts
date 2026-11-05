const pending = new Set<symbol>()

/** 非模态表单里的修改目前还没有进入持久化的项目。 */
export function registerPendingPropertyEdit(): () => void {
  const key = Symbol()
  pending.add(key)
  return () => { pending.delete(key) }
}

export function hasPendingPropertyEdits(): boolean { return pending.size > 0 }
