export type CitySelectionMode = 'toggle' | 'range' | 'add' | undefined

/** Selection is transient. Range selection follows the visible scene-tree order. */
export function selectCityIds(current: readonly string[], id: string, mode: CitySelectionMode, order: readonly string[], anchor: string | null): string[] {
  if (!order.includes(id)) return [...current]
  if (mode === 'range' && anchor && order.includes(anchor)) {
    const start = order.indexOf(anchor), end = order.indexOf(id)
    return order.slice(Math.min(start, end), Math.max(start, end) + 1)
  }
  if (mode === 'toggle') return current.includes(id) ? current.filter(value => value !== id) : [...current, id]
  if (mode === 'add') return [...new Set([...current, id])]
  return [id]
}
