export type SceneSelectionMode = 'toggle' | 'range' | 'add' | undefined

/** 选择是临时的。范围选择按场景树当前可见的顺序进行。 */
export function selectSceneIds(current: readonly string[], id: string, mode: SceneSelectionMode, order: readonly string[], anchor: string | null): string[] {
  if (!order.includes(id)) return [...current]
  if (mode === 'range' && anchor && order.includes(anchor)) {
    const start = order.indexOf(anchor), end = order.indexOf(id)
    return order.slice(Math.min(start, end), Math.max(start, end) + 1)
  }
  if (mode === 'toggle') return current.includes(id) ? current.filter(value => value !== id) : [...current, id]
  if (mode === 'add') return [...new Set([...current, id])]
  return [id]
}
