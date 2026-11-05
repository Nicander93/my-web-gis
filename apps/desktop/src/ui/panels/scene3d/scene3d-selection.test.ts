import { describe, expect, it } from 'vitest'
import { selectSceneIds } from './scene3d-selection'

describe('scene tree selection', () => {
  it('toggles, adds and replaces selection without mutating its input', () => {
    const current = ['a'], order = ['a','b','c']
    expect(selectSceneIds(current, 'b', 'toggle', order, 'a')).toEqual(['a','b'])
    expect(selectSceneIds(current, 'a', 'toggle', order, 'a')).toEqual([])
    expect(selectSceneIds(current, 'a', 'add', order, 'a')).toEqual(['a'])
    expect(selectSceneIds(current, 'b', undefined, order, 'a')).toEqual(['b'])
    expect(current).toEqual(['a'])
  })
  it('selects ranges in visible order and handles collapsed/removed anchors', () => {
    const order = ['c','a','b','d']
    expect(selectSceneIds(['b'], 'c', 'range', order, 'b')).toEqual(['c','a','b'])
    expect(selectSceneIds(['c'], 'd', 'range', order, 'c')).toEqual(order)
    expect(selectSceneIds(['a'], 'd', 'range', order, 'removed')).toEqual(['d'])
    expect(selectSceneIds(['a'], 'missing', 'toggle', order, 'a')).toEqual(['a'])
  })
})
