import { describe, expect, it } from 'vitest'
import { computeFieldStats, statsScopeLabel } from './stats'
import type { GisFeature } from './types'

function feat(id: string, properties: Record<string, unknown>): GisFeature {
  return { id, geometry: { type: 'Point', coordinates: [0, 0] }, properties }
}

describe('computeFieldStats', () => {
  it('labels scope and counts null/non-null', () => {
    const features = [
      feat('1', { pop: 10 }),
      feat('2', { pop: null }),
      feat('3', { pop: 20 }),
      feat('4', {})
    ]
    const stats = computeFieldStats(features, 'pop', 'filtered')
    expect(stats.scopeLabel).toBe(statsScopeLabel('filtered'))
    expect(stats.total).toBe(4)
    expect(stats.nonNull).toBe(2)
    expect(stats.nullCount).toBe(2)
    expect(stats.numeric).toEqual({ min: 10, max: 20, sum: 30, mean: 15, count: 2 })
  })

  it('empty set does not produce NaN', () => {
    const stats = computeFieldStats([], 'pop', 'all')
    expect(stats.total).toBe(0)
    expect(stats.nonNull).toBe(0)
    expect(stats.nullCount).toBe(0)
    expect(stats.numeric).toBeNull()
    expect(Number.isNaN(stats.numeric?.mean ?? 0)).toBe(false)
  })

  it('non-numeric field has null numeric block', () => {
    const features = [feat('1', { name: 'A' }), feat('2', { name: 'B' })]
    expect(computeFieldStats(features, 'name', 'table').numeric).toBeNull()
  })
})
