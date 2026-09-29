import { describe, expect, it } from 'vitest'
import {
  applyFieldFilter,
  intersectSelectionIds,
  matchFieldCondition,
  type FieldFilterCondition
} from './filter'
import type { GisFeature } from './types'

function feat(id: string, properties: Record<string, unknown>): GisFeature {
  return {
    id,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties
  }
}

const sample: GisFeature[] = [
  feat('a', { name: 'Alpha', pop: 10, note: '' }),
  feat('b', { name: 'Beta', pop: 20, note: 'river' }),
  feat('c', { name: 'Gamma', pop: null, note: 'lake' }),
  feat('d', { name: 'Delta', pop: 5 })
]

describe('field filter set semantics', () => {
  it('empty conditions return all features (F = A)', () => {
    expect(applyFieldFilter(sample, []).map((f) => f.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(applyFieldFilter(sample, undefined).map((f) => f.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('AND of eq / neq / contains / comparisons / is-empty', () => {
    const conditions: FieldFilterCondition[] = [
      { field: 'name', op: 'contains', value: 'lph' },
      { field: 'pop', op: 'gte', value: 10 }
    ]
    expect(applyFieldFilter(sample, conditions).map((f) => f.id)).toEqual(['a'])
  })

  it('handles empty values separately', () => {
    expect(matchFieldCondition({ note: '' }, { field: 'note', op: 'is-empty' })).toBe(true)
    expect(matchFieldCondition({ note: 'x' }, { field: 'note', op: 'is-empty' })).toBe(false)
    expect(matchFieldCondition({}, { field: 'missing', op: 'is-empty' })).toBe(true)
    expect(matchFieldCondition({ pop: null }, { field: 'pop', op: 'is-not-empty' })).toBe(false)
    expect(applyFieldFilter(sample, [{ field: 'note', op: 'is-empty' }]).map((f) => f.id)).toEqual([
      'a',
      'd'
    ])
  })

  it('numeric boundary: non-numeric fails comparison rather than throwing', () => {
    expect(matchFieldCondition({ pop: 'n/a' }, { field: 'pop', op: 'gt', value: 1 })).toBe(false)
    expect(matchFieldCondition({ pop: 10 }, { field: 'pop', op: 'lt', value: 'x' })).toBe(false)
  })

  it('neq and eq with numbers and strings', () => {
    expect(matchFieldCondition({ pop: 10 }, { field: 'pop', op: 'eq', value: '10' })).toBe(true)
    expect(matchFieldCondition({ pop: 10 }, { field: 'pop', op: 'neq', value: 20 })).toBe(true)
    expect(matchFieldCondition({ name: 'Alpha' }, { field: 'name', op: 'eq', value: 'Alpha' })).toBe(
      true
    )
  })

  it('intersectSelectionIds converges S to S ∩ F by Feature ID', () => {
    const filtered = applyFieldFilter(sample, [{ field: 'pop', op: 'gte', value: 10 }])
    expect(filtered.map((f) => f.id)).toEqual(['a', 'b'])
    expect(intersectSelectionIds(['a', 'c', 'd'], filtered)).toEqual(['a'])
    expect(intersectSelectionIds([], filtered)).toEqual([])
  })
})
