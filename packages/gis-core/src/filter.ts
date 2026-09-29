/** Field filter conditions (persisted F) — AND semantics, no JS/SQL/eval. */
import type { GisFeature } from './types'

export type FieldFilterOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'is-empty'
  | 'is-not-empty'

export interface FieldFilterCondition {
  field: string
  op: FieldFilterOp
  /** Required for comparison ops; ignored for is-empty / is-not-empty. */
  value?: unknown
}

export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function asComparableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asSearchString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Evaluate one condition against feature properties. */
export function matchFieldCondition(
  properties: Record<string, unknown>,
  condition: FieldFilterCondition
): boolean {
  const raw = properties[condition.field]

  switch (condition.op) {
    case 'is-empty':
      return isEmptyValue(raw)
    case 'is-not-empty':
      return !isEmptyValue(raw)
    case 'eq': {
      if (isEmptyValue(raw) && isEmptyValue(condition.value)) return true
      if (isEmptyValue(raw) || isEmptyValue(condition.value)) return false
      const leftNum = asComparableNumber(raw)
      const rightNum = asComparableNumber(condition.value)
      if (leftNum !== null && rightNum !== null) return leftNum === rightNum
      return asSearchString(raw) === asSearchString(condition.value)
    }
    case 'neq':
      return !matchFieldCondition(properties, { ...condition, op: 'eq' })
    case 'contains': {
      if (isEmptyValue(raw) || isEmptyValue(condition.value)) return false
      return asSearchString(raw)
        .toLowerCase()
        .includes(asSearchString(condition.value).toLowerCase())
    }
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const left = asComparableNumber(raw)
      const right = asComparableNumber(condition.value)
      if (left === null || right === null) return false
      if (condition.op === 'lt') return left < right
      if (condition.op === 'lte') return left <= right
      if (condition.op === 'gt') return left > right
      return left >= right
    }
    default:
      return false
  }
}

/**
 * Apply AND of field conditions. Empty conditions ⇒ identity (F = A).
 * Returns a new array; does not mutate input. Stable Feature IDs preserved.
 */
export function applyFieldFilter(
  features: readonly GisFeature[],
  conditions: readonly FieldFilterCondition[] | undefined | null
): GisFeature[] {
  if (!conditions || conditions.length === 0) {
    return features.slice()
  }
  return features.filter((feature) =>
    conditions.every((condition) => matchFieldCondition(feature.properties, condition))
  )
}

/** Converge selection to S ∩ F (by stable Feature ID). */
export function intersectSelectionIds(
  selectedIds: readonly string[],
  filteredFeatures: readonly GisFeature[]
): string[] {
  if (selectedIds.length === 0) return []
  const allowed = new Set(filteredFeatures.map((f) => f.id))
  return selectedIds.filter((id) => allowed.has(id))
}
