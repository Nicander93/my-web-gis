/** Stable multi-field sort with Feature ID tie-break (never row index). */
import type { GisFeature } from './types'
import { isEmptyValue } from './filter'

export interface SortSpec {
  field: string
  direction: 'asc' | 'desc'
}

function compareValues(a: unknown, b: unknown): number {
  const aEmpty = isEmptyValue(a)
  const bEmpty = isEmptyValue(b)
  if (aEmpty && bEmpty) return 0
  if (aEmpty) return 1
  if (bEmpty) return -1

  if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b)) {
    return a === b ? 0 : a < b ? -1 : 1
  }

  const aNum = typeof a === 'number' && Number.isFinite(a) ? a : Number(a)
  const bNum = typeof b === 'number' && Number.isFinite(b) ? b : Number(b)
  if (
    typeof a !== 'boolean' &&
    typeof b !== 'boolean' &&
    Number.isFinite(aNum) &&
    Number.isFinite(bNum) &&
    String(a).trim() !== '' &&
    String(b).trim() !== ''
  ) {
    return aNum === bNum ? 0 : aNum < bNum ? -1 : 1
  }

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Sort features by specs (AND order). Null/empty values sort last in asc, first in desc.
 * Final tie-break is stable Feature ID ascending.
 */
export function sortFeatures(
  features: readonly GisFeature[],
  specs: readonly SortSpec[] | undefined | null
): GisFeature[] {
  const list = features.map((feature, index) => ({ feature, index }))
  const active = specs?.filter((s) => s.field) ?? []

  list.sort((left, right) => {
    for (const spec of active) {
      const cmp = compareValues(left.feature.properties[spec.field], right.feature.properties[spec.field])
      if (cmp !== 0) return spec.direction === 'desc' ? -cmp : cmp
    }
    const idCmp = left.feature.id.localeCompare(right.feature.id)
    if (idCmp !== 0) return idCmp
    return left.index - right.index
  })

  return list.map((item) => item.feature)
}
