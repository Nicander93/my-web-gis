import { describe, expect, it, vi } from 'vitest'
import { MemoryFeatureStore } from './featureStore'
import type { GisFeature } from './types'

const feature = (id: string, value = 1): GisFeature => ({ id, geometry: { type: 'Point', coordinates: [value, 0] }, properties: { value } })

describe('MemoryFeatureStore data ownership', () => {
  it('protects its shared view and retains unaffected dataset and feature references', () => {
    const store = new MemoryFeatureStore(), input = feature('one')
    store.replaceAll({ first: [input, feature('two')], second: [feature('other')] })
    const before = store.readSnapshot()
    expect(store.readSnapshot()).toBe(before)
    input.properties.value = 99
    expect(before.first[0].properties.value).toBe(1)
    expect(() => { before.first[0].properties.value = 8 }).toThrow()
    expect(() => { before.first.push(feature('extra')) }).toThrow()
    store.update('first', feature('one', 2))
    const after = store.readSnapshot()
    expect(after.second).toBe(before.second)
    expect(after.first[1]).toBe(before.first[1])
    expect(after.first[0]).not.toBe(before.first[0])
    const detached = store.snapshot()
    detached.first[0].properties.value = 88
    expect(store.getById('first', 'one')?.properties.value).toBe(2)
  })

  it('rolls back mixed dataset and row writes without publishing or advancing its revision', () => {
    const store = new MemoryFeatureStore()
    store.replaceAll({ first: [feature('one'), feature('two')], second: [feature('other')] })
    const before = store.readSnapshot(), revision = store.revision, listener = vi.fn()
    store.subscribe(listener)
    expect(() => store.transaction(() => {
      store.update('first', feature('one', 9)); store.remove('first', 'one')
      store.clear('first'); store.clear('second'); store.setAll('third', [feature('new')])
      throw new Error('failure')
    })).toThrow('failure')
    expect(store.readSnapshot()).toBe(before)
    expect(store.snapshot()).toEqual(before)
    expect(store.getDatasetIds()).toEqual(['first', 'second'])
    expect(store.revision).toBe(revision)
    expect(listener).not.toHaveBeenCalled()
    store.transaction(() => { store.update('first', feature('one', 2)); store.add('first', feature('three')) })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.revision).toBe(revision + 1)
  })

  it('supports nested savepoints and clears previous-project data without creating datasets on reads', () => {
    const store = new MemoryFeatureStore()
    expect(store.getAll('missing')).toEqual([])
    expect(store.getById('missing', 'id')).toBeUndefined()
    expect(store.getDatasetIds()).toEqual([])
    store.transaction(() => {
      store.setAll('one', [feature('one')])
      expect(() => store.transaction(() => { store.update('one', feature('one', 3)); throw new Error('inner') })).toThrow('inner')
      expect(store.getById('one', 'one')?.properties.value).toBe(1)
      store.add('one', feature('two'))
    })
    expect(store.readSnapshot().one).toHaveLength(2)
    store.replaceAll({ next: [feature('next')] })
    expect(store.getDatasetIds()).toEqual(['next'])
  })
})
