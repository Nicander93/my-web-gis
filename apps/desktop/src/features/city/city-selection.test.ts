import { describe, expect, it } from 'vitest'
import { selectCityIds } from './city-selection'

describe('scene tree selection', () => {
  it('toggles, adds and replaces selection without mutating its input', () => {
    const current = ['a'], order = ['a','b','c']
    expect(selectCityIds(current, 'b', 'toggle', order, 'a')).toEqual(['a','b'])
    expect(selectCityIds(current, 'a', 'toggle', order, 'a')).toEqual([])
    expect(selectCityIds(current, 'a', 'add', order, 'a')).toEqual(['a'])
    expect(selectCityIds(current, 'b', undefined, order, 'a')).toEqual(['b'])
    expect(current).toEqual(['a'])
  })
  it('selects ranges in visible order and handles collapsed/removed anchors', () => {
    const order = ['c','a','b','d']
    expect(selectCityIds(['b'], 'c', 'range', order, 'b')).toEqual(['c','a','b'])
    expect(selectCityIds(['c'], 'd', 'range', order, 'c')).toEqual(order)
    expect(selectCityIds(['a'], 'd', 'range', order, 'removed')).toEqual(['d'])
    expect(selectCityIds(['a'], 'missing', 'toggle', order, 'a')).toEqual(['a'])
  })
})
