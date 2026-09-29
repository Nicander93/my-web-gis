import { describe, expect, it } from 'vitest'
import { sortFeatures } from './sort'
import type { GisFeature } from './types'

function feat(id: string, properties: Record<string, unknown>): GisFeature {
  return { id, geometry: { type: 'Point', coordinates: [0, 0] }, properties }
}

describe('sortFeatures', () => {
  it('sorts by field then stable Feature ID (not row index)', () => {
    const features = [
      feat('z', { rank: 1 }),
      feat('a', { rank: 1 }),
      feat('m', { rank: 2 }),
      feat('b', { rank: null })
    ]
    const sorted = sortFeatures(features, [{ field: 'rank', direction: 'asc' }])
    expect(sorted.map((f) => f.id)).toEqual(['a', 'z', 'm', 'b'])
  })

  it('desc puts empties first after value order reverse', () => {
    const features = [feat('c', { v: 3 }), feat('a', { v: 1 }), feat('b', { v: null })]
    expect(sortFeatures(features, [{ field: 'v', direction: 'desc' }]).map((f) => f.id)).toEqual([
      'b',
      'c',
      'a'
    ])
  })

  it('empty specs still order by Feature ID', () => {
    const features = [feat('c', {}), feat('a', {}), feat('b', {})]
    expect(sortFeatures(features, []).map((f) => f.id)).toEqual(['a', 'b', 'c'])
  })
})
