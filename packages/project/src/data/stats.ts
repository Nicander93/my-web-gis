/** Field statistics with explicit scope label; never emit NaN. */
import type { GisFeature } from './types'
import { isEmptyValue } from './filter'

export type StatsScope = 'all' | 'filtered' | 'selection' | 'table'

export interface NumericFieldStats {
  min: number
  max: number
  sum: number
  mean: number
  count: number
}

export interface FieldStats {
  field: string
  /** Human-readable / enum scope for UI labeling. */
  scope: StatsScope
  scopeLabel: string
  total: number
  nonNull: number
  nullCount: number
  /** Present only when at least one finite numeric value exists. */
  numeric: NumericFieldStats | null
}

const SCOPE_LABELS: Record<StatsScope, string> = {
  all: '全部要素 (A)',
  filtered: '图层筛选结果 (F)',
  selection: '当前选中 (S)',
  table: '当前表格结果'
}

export function statsScopeLabel(scope: StatsScope): string {
  return SCOPE_LABELS[scope]
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Compute field stats over the given feature set.
 * Empty input ⇒ zeros and numeric=null (no NaN).
 */
export function computeFieldStats(
  features: readonly GisFeature[],
  field: string,
  scope: StatsScope = 'filtered'
): FieldStats {
  let nonNull = 0
  let nullCount = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  let sum = 0
  let numericCount = 0

  for (const feature of features) {
    const value = feature.properties[field]
    if (isEmptyValue(value)) {
      nullCount += 1
      continue
    }
    nonNull += 1
    const n = asFiniteNumber(value)
    if (n !== null) {
      numericCount += 1
      sum += n
      if (n < min) min = n
      if (n > max) max = n
    }
  }

  const total = features.length
  const numeric: NumericFieldStats | null =
    numericCount > 0
      ? {
          min,
          max,
          sum,
          mean: sum / numericCount,
          count: numericCount
        }
      : null

  return {
    field,
    scope,
    scopeLabel: statsScopeLabel(scope),
    total,
    nonNull,
    nullCount,
    numeric
  }
}
