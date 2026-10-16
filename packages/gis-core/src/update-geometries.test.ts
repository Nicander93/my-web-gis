import { describe, expect, it } from 'vitest'
import { EditHistory, MemoryFeatureStore, UpdateGeometriesCommand } from './index'
import type { GeometryChange, GisFeature } from './index'

function fixture() {
  const featureStore = new MemoryFeatureStore(), history = new EditHistory()
  const features: GisFeature[] = ['a', 'b', 'other'].map(id => ({ id, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: id }, metadata: { sourceId: id } }))
  featureStore.setAll('data', features)
  const changes: GeometryChange[] = features.slice(0, 2).map(feature => ({ featureId: feature.id, before: feature.geometry, after: { type: 'LineString', coordinates: [[0, 0], [2, 2]] } }))
  return { featureStore, history, changes, features, context: { featureStore } }
}

describe('shared vertex geometry transaction', () => {
  it('commits two targets as one undo/redo step without changing properties or unrelated features', () => {
    const f = fixture(), command = new UpdateGeometriesCommand('cmd', 'data', f.changes)
    f.changes[0].after = f.changes[0].before
    f.history.execute(command, f.context)
    expect(f.history.undoCount).toBe(1)
    for (const id of ['a', 'b']) expect(f.featureStore.getById('data', id)).toEqual({ ...f.features.find(feature => feature.id === id), geometry: { type: 'LineString', coordinates: [[0, 0], [2, 2]] } })
    expect(f.featureStore.getById('data', 'other')).toEqual(f.features[2])
    f.history.undo(f.context)
    expect(f.featureStore.getAll('data')).toEqual(f.features)
    f.history.redo(f.context)
    expect(f.history.undoCount).toBe(1)
    expect(f.featureStore.getById('data', 'b')?.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [2, 2]] })
  })
  it('rejects a stale or missing target before writing any geometry or history', () => {
    const f = fixture()
    f.featureStore.remove('data', 'b')
    const before = f.featureStore.snapshot()
    expect(() => f.history.execute(new UpdateGeometriesCommand('cmd', 'data', f.changes), f.context)).toThrow('target changed')
    expect(f.featureStore.snapshot()).toEqual(before)
    expect(f.history.undoCount).toBe(0)
  })
  it('leaves undo history and content intact when an externally changed target blocks undo', () => {
    const f = fixture()
    f.history.execute(new UpdateGeometriesCommand('cmd', 'data', f.changes), f.context)
    f.featureStore.update('data', { ...f.features[1], geometry: { type: 'Point', coordinates: [8, 8] } })
    const before = f.featureStore.snapshot()
    expect(() => f.history.undo(f.context)).toThrow('target changed')
    expect(f.featureStore.snapshot()).toEqual(before)
    expect(f.history.undoCount).toBe(1)
  })
})
