export interface FeatureRef { layerKey: string; featureId: string | number }
export type SelectionOperation = 'replace' | 'add' | 'remove'

export function sameFeature(a: FeatureRef, b: FeatureRef): boolean {
  return a.layerKey === b.layerKey && a.featureId === b.featureId
}

/** Preserve identity types and stable order without delimiter-based composite keys. */
export function uniqueSelection(values: readonly FeatureRef[]): FeatureRef[] {
  const keys = new Map<string, Set<string | number>>()
  return values.filter(value => {
    let ids = keys.get(value.layerKey)
    if (!ids) { ids = new Set(); keys.set(value.layerKey, ids) }
    if (ids.has(value.featureId)) return false
    ids.add(value.featureId)
    return true
  }).map(value => ({ ...value }))
}

export function applySelection(current: readonly FeatureRef[], hits: readonly FeatureRef[], operation: SelectionOperation): FeatureRef[] {
  if (operation === 'replace') return uniqueSelection(hits)
  if (operation === 'add') return uniqueSelection([...current, ...hits])
  const remove = new Map<string, Set<string | number>>()
  for (const hit of hits) {
    let ids = remove.get(hit.layerKey)
    if (!ids) { ids = new Set(); remove.set(hit.layerKey, ids) }
    ids.add(hit.featureId)
  }
  return uniqueSelection(current.filter(value => !remove.get(value.layerKey)?.has(value.featureId)))
}

export function selectionOperation(event: Pick<MouseEvent, 'altKey' | 'shiftKey'>): SelectionOperation {
  return event.altKey ? 'remove' : event.shiftKey ? 'add' : 'replace'
}
