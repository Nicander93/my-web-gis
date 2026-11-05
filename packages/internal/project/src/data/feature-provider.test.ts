import { describe, expect, it, vi } from 'vitest'
import { FeatureEditBuffer, MemoryFeatureProvider } from './feature-provider'
import type { GisFeature } from './types'
import { EditHistory, UpdateGeometryCommand } from '../history/editHistory'
import { MemoryFeatureStore } from './featureStore'
import { readGeoJsonFields, stringifyGeoJson } from './geojson'

const row = (id: string, x = 0, value = 1): GisFeature => ({ id, geometry: { type: 'Point', coordinates: [x, 0] }, properties: { value } })

describe('provider source and incremental effective view', () => {
  it('rejects scalar type and nullability violations before publishing or invoking persistence', async () => {
    const fields = [{ name: 'value', type: 'number' as const, nullable: false }], write = vi.fn(async () => {})
    const provider = new MemoryFeatureProvider('data', [row('a')], write, fields), buffer = new FeatureEditBuffer(provider)
    buffer.putLoaded({ ...row('a'), properties: { value: 'bad' } })
    await expect(buffer.save()).rejects.toThrow('Invalid number')
    expect(write).not.toHaveBeenCalled(); expect(provider.revision).toBe(0); expect(buffer.pendingCount).toBe(1)
    buffer.putLoaded({ ...row('a'), properties: { value: 2 } }); await buffer.save()
    buffer.setLoadedFields([{ name: 'missing', type: 'number', nullable: false }])
    await expect(buffer.save()).rejects.toThrow('does not allow null')
    expect(write).toHaveBeenCalledTimes(1); expect(await provider.getFields()).toEqual(fields)
    expect(buffer.pendingCount).toBe(1)
  })

  it('persists schema-only changes after acknowledgement while retaining typed empty columns', async () => {
    const fields = [{ name: 'code', type: 'string' as const, nullable: true }]
    const write = vi.fn(async () => {})
    const provider = new MemoryFeatureProvider('empty', [], write), buffer = new FeatureEditBuffer(provider)
    buffer.setLoadedFields(fields)
    expect(buffer.pendingCount).toBe(1); expect(await provider.getFields()).toBeUndefined()
    await buffer.save()
    expect(write.mock.calls[0]).toMatchObject([[], undefined, fields])
    expect(await provider.getFields()).toEqual(fields); expect(buffer.pendingCount).toBe(0)
    buffer.setLoadedFields(undefined); expect(buffer.pendingCount).toBe(1)
    buffer.setLoadedFields(fields); expect(buffer.pendingCount).toBe(0)
    const document = JSON.parse(stringifyGeoJson([], fields))
    expect(readGeoJsonFields(document)).toEqual(fields)
    document['webgis:schema'].version = 2
    expect(() => readGeoJsonFields(document)).toThrow('Unsupported')
  })
  it('rolls schema and row edits back together and retains schema after persistence failure', async () => {
    const fields = [{ name: 'value', type: 'number' as const, nullable: false }]
    const write = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(undefined)
    const provider = new MemoryFeatureProvider('data', [row('a')], write), buffer = new FeatureEditBuffer(provider)
    expect(() => buffer.transaction(() => { buffer.setLoadedFields(fields); buffer.putLoaded(row('a', 9)); throw new Error('invalid') })).toThrow('invalid')
    expect(buffer.pendingCount).toBe(0); expect(buffer.getLoadedFields()).toBeUndefined()
    buffer.setLoadedFields(fields)
    await expect(buffer.save()).rejects.toThrow('failed')
    expect(buffer.getLoadedFields()).toEqual(fields); expect(await provider.getFields()).toBeUndefined()
    await buffer.save(); expect(await provider.getFields()).toEqual(fields)
    expect(() => buffer.setLoadedFields([fields[0], fields[0]])).toThrow('Invalid')
    expect(buffer.pendingCount).toBe(0)
  })

  it('publishes durable commits only after acknowledgement and isolates the persistence adapter', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const provider = new MemoryFeatureProvider('data', [row('a')], async rows => { rows[0].properties.value = 99; await gate })
    const committing = provider.commit({ inserts: [], updates: [row('a', 4)], deletes: [] }, { expectedRevision: 0 })
    expect(await provider.getById('a')).toEqual(row('a')); expect(provider.revision).toBe(0)
    await expect(provider.commit({ inserts: [], updates: [], deletes: [] }, { expectedRevision: 0 })).rejects.toThrow('in progress')
    expect(() => provider.dispose()).toThrow('in progress')
    release(); await committing
    expect(await provider.getById('a')).toEqual(row('a', 4)); expect(provider.revision).toBe(1)
  })

  it('runs existing geometry commands and the sole EditHistory against a loaded overlay', async () => {
    const provider = new MemoryFeatureProvider('data', [row('a')]), buffer = new FeatureEditBuffer(provider)
    const featureStore = new MemoryFeatureStore(), history = new EditHistory(), context = { featureStore }
    vi.spyOn(featureStore, 'getById').mockImplementation((_dataset, id) => buffer.getLoadedById(id) ?? undefined)
    vi.spyOn(featureStore, 'update').mockImplementation((_dataset, feature) => buffer.putLoaded(feature))
    const command = new UpdateGeometryCommand('move', 'data', 'a', row('a').geometry, row('a', 3).geometry)
    buffer.transaction(() => history.execute(command, context))
    expect(buffer.getLoadedById('a')).toEqual(row('a', 3)); expect(await provider.getById('a')).toEqual(row('a'))
    buffer.transaction(() => history.undo(context)); expect(buffer.pendingCount).toBe(0)
    buffer.transaction(() => history.redo(context)); expect(buffer.pendingCount).toBe(1)
    expect(() => buffer.transaction(() => history.execute({ id: 'fail', label: 'Fail', execute() { buffer.putLoaded(row('a', 8)); throw new Error('invalid') }, undo() {} }, context))).toThrow('invalid')
    expect(buffer.getLoadedById('a')).toEqual(row('a', 3)); expect(history.undoCount).toBe(1)
  })
  it('rolls nested transactions back to their boundary and restores insertion ordering', async () => {
    const provider = new MemoryFeatureProvider('data', []), buffer = new FeatureEditBuffer(provider)
    buffer.putLoaded(row('a')); buffer.putLoaded(row('b'))
    const before = buffer.pendingBatch()
    expect(() => buffer.transaction(() => { buffer.removeLoaded('a'); buffer.putLoaded(row('c')); throw new Error('fail') })).toThrow('fail')
    expect(buffer.pendingBatch()).toEqual(before)
    buffer.transaction(() => {
      buffer.putLoaded(row('a', 2))
      expect(() => buffer.transaction(() => { buffer.putLoaded(row('a', 9)); throw new Error('inner') })).toThrow('inner')
      expect(buffer.getLoadedById('a')).toEqual(row('a', 2))
    })
    expect((await buffer.query()).features).toEqual([row('a', 2), row('b')])
  })
  it('rejects asynchronous transaction callbacks and destructive lifecycle calls during an edit', async () => {
    const provider = new MemoryFeatureProvider('data', []), buffer = new FeatureEditBuffer(provider)
    expect(() => buffer.transaction(async () => { buffer.putLoaded(row('a')) })).toThrow('synchronous')
    expect(buffer.pendingCount).toBe(0)
    buffer.putLoaded(row('a'))
    expect(() => buffer.transaction(() => buffer.discard())).toThrow('Cannot discard')
    expect(() => buffer.transaction(() => buffer.save())).toThrow('synchronous')
    expect(buffer.pendingCount).toBe(1)
    provider.dispose(); expect(() => buffer.putLoaded(row('new'))).toThrow('disposed')
  })

  it('holds the captured batch stable and rejects edits while a save is in flight', async () => {
    const provider = new MemoryFeatureProvider('data', [row('a')]), buffer = new FeatureEditBuffer(provider)
    await buffer.put(row('a', 4))
    const commit = provider.commit.bind(provider)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(provider, 'commit').mockImplementation(async (batch, options) => { await gate; return commit(batch, options) })
    const saving = buffer.save()
    await expect(buffer.put(row('new'))).rejects.toThrow('in progress')
    expect(() => buffer.discard()).toThrow('in progress')
    const detached = buffer.pendingBatch(); detached.updates[0].properties.value = 99
    release(); await saving
    expect(await provider.getById('a')).toEqual(row('a', 4)); expect(buffer.pendingCount).toBe(0)
  })

  it('reads all provider pages before applying effective-view pagination', async () => {
    const provider = new MemoryFeatureProvider('data', [row('a'), row('b'), row('c')]), buffer = new FeatureEditBuffer(provider)
    const query = provider.query.bind(provider)
    vi.spyOn(provider, 'query').mockImplementation(options => query({ ...options, limit: 2 }))
    await buffer.remove('a')
    expect(await buffer.query({ offset: 1, limit: 1 })).toEqual({ features: [row('c')], hasMore: false })
  })

  it('keeps source rows untouched until save, detaches reads, and cancels reverted deltas', async () => {
    const provider = new MemoryFeatureProvider('data', [row('a')]), buffer = new FeatureEditBuffer(provider)
    await buffer.put(row('a', 3)); expect(buffer.pendingCount).toBe(1)
    expect(await provider.getById('a')).toEqual(row('a'))
    const read = await buffer.getById('a'); read!.properties.value = 9
    expect(await buffer.getById('a')).toEqual(row('a', 3))
    await buffer.put(row('a')); expect(buffer.pendingCount).toBe(0)
    await buffer.put(row('new')); await buffer.remove('new'); expect(buffer.pendingCount).toBe(0)
    await buffer.put(row('a', 4)); await buffer.save()
    expect(await provider.getById('a')).toEqual(row('a', 4)); expect(buffer.pendingCount).toBe(0)
  })
  it('reconciles moved-in/moved-out edits, filters, insert/delete and pagination together', async () => {
    const provider = new MemoryFeatureProvider('data', [row('out', 100), row('move', 0), row('delete', 0), row('keep', 0)])
    const buffer = new FeatureEditBuffer(provider)
    await buffer.put(row('out', 0)); await buffer.put(row('move', 100)); await buffer.remove('delete'); await buffer.put(row('new', 0, 2))
    const query = { extent: [-1, -1, 1, 1] as [number, number, number, number], filter: [{ field: 'value', op: 'eq' as const, value: 1 }], limit: 1 }
    expect(await buffer.query(query)).toEqual({ features: [row('out')], hasMore: true })
    expect(await buffer.query({ ...query, offset: 1 })).toEqual({ features: [row('keep')], hasMore: false })
    expect((await provider.query()).features).toHaveLength(4)
  })
  it('rejects duplicate/invalid batches atomically and detects external commits', async () => {
    const provider = new MemoryFeatureProvider('data', [row('a')]), buffer = new FeatureEditBuffer(provider)
    await expect(provider.commit({ inserts: [row('new')], updates: [row('missing')], deletes: [] }, { expectedRevision: 0 })).rejects.toThrow('conflict')
    expect((await provider.query()).features).toEqual([row('a')]); expect(provider.revision).toBe(0)
    await buffer.put(row('a', 2))
    await provider.commit({ inserts: [], updates: [row('a', 8)], deletes: [] }, { expectedRevision: 0 })
    await expect(buffer.save()).rejects.toThrow('version conflict'); expect(buffer.pendingCount).toBe(1)
    buffer.discard(); expect(await buffer.getById('a')).toEqual(row('a', 8))
  })
  it('retains the overlay after commit failure and permits retry', async () => {
    const provider = new MemoryFeatureProvider('data', [row('a')]), buffer = new FeatureEditBuffer(provider)
    await buffer.remove('a'); await buffer.put(row('new'))
    const commit = vi.spyOn(provider, 'commit').mockRejectedValueOnce(new Error('disk failure'))
    await expect(buffer.save()).rejects.toThrow('disk failure')
    expect(buffer.pendingCount).toBe(2); expect(await provider.getById('a')).toEqual(row('a'))
    expect((await buffer.query()).features).toEqual([row('new')])
    await buffer.save(); expect(buffer.pendingCount).toBe(0); expect(commit).toHaveBeenCalledTimes(2)
  })
  it('rejects cancellation and disposed sources without dropping pending changes', async () => {
    const provider = new MemoryFeatureProvider('data', [row('a')]), buffer = new FeatureEditBuffer(provider)
    await buffer.put(row('a', 3))
    const controller = new AbortController(); controller.abort()
    await expect(buffer.save(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(buffer.pendingCount).toBe(1); expect(provider.revision).toBe(0)
    provider.dispose(); await expect(buffer.query()).rejects.toThrow('disposed')
  })
  it('restores a captured pending batch onto a fresh source baseline', async () => {
    const fields = [{ name: 'value', type: 'number' as const, nullable: true }]
    const live = new FeatureEditBuffer(new MemoryFeatureProvider('data', [row('a'), row('gone')], undefined, fields))
    live.putLoaded(row('a', 9)); live.putLoaded(row('b', 2)); live.removeLoaded('gone')
    live.setLoadedFields([...fields, { name: 'code', type: 'string', nullable: true }])
    const batch = live.pendingBatch()
    const restored = new FeatureEditBuffer(new MemoryFeatureProvider('data', [row('a'), row('gone')], undefined, fields))
    restored.restorePending(batch)
    expect(restored.pendingCount).toBe(live.pendingCount)
    expect(restored.getLoadedRows()).toEqual(live.getLoadedRows())
    expect(restored.getLoadedFields()).toEqual(live.getLoadedFields())
    expect(await restored.provider.getById('a')).toEqual(row('a'))
    expect(() => restored.restorePending(batch)).toThrow('pending')
  })
})
