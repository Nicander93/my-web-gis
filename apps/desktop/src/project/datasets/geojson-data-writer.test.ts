import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeFeatureData } from './feature-data-runtime'
import { createGeoJsonDataWriter } from './geojson-data-writer'
import { stringifyManagedDatasetFile, type GisFeature } from '@desktop-webgis/project'
import { importGeoJson } from '@/io/import-parser'
const files = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('@/platform/files', () => ({ readTextFile: files.read, writeTextFile: files.write }))
const row = (value: number): GisFeature => ({ id: 'a', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value } })
beforeEach(() => { files.read.mockReset(); files.write.mockReset() })

describe('durable dataset publication boundary', () => {
  it('reopens acknowledged data with original provenance and rejects a second coordinate transform', async () => {
    const before = row(1); before.geometry = { type: 'Point', coordinates: [116.4, 39.9] }
    before.metadata = { sourceId: 42, sourceCrs: 'EPSG:3857', importId: 'source-import', overlaySourceId: 'origin' }
    const data = new RuntimeFeatureData(); data.setAll('data', [before]); data.update('data', { ...before, properties: { value: 9 } })
    files.write.mockResolvedValue(undefined)
    await data.saveDataset('data', createGeoJsonDataWriter('D:/managed.geojson'))
    const content = files.write.mock.calls[0][1], file = new File([content], 'managed.geojson')
    const reopened = await importGeoJson(file)
    expect(reopened.errors).toEqual([]); expect(reopened.layers[0].warnings).toEqual([])
    expect(reopened.layers[0].features).toEqual([{ ...before, properties: { value: 9 } }])
    const conflict = await importGeoJson(file, { sourceCrs: { code: 'EPSG:3857' } })
    expect(conflict.layers).toEqual([]); expect(conflict.errors[0]).toContain('重复指定源投影')
    const unsupported = JSON.parse(content); unsupported['webgis:dataset'].version = 2
    expect((await importGeoJson(new File([JSON.stringify(unsupported)], 'future.geojson'))).layers).toEqual([])
  })

  it('retains source and overlay when JSON serialization would lose data', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row(1)])
    data.update('data', { ...row(9), properties: { value: 9, invalid: undefined } })
    const cache = data.readSnapshot(), writer = createGeoJsonDataWriter('D:/managed.geojson')
    await expect(data.saveDataset('data', writer)).rejects.toThrow('non-JSON')
    expect(files.write).not.toHaveBeenCalled(); expect(data.readSnapshot()).toBe(cache)
    expect(await data.readSource('data')).toEqual([row(1)]); expect(data.pendingCount()).toBe(1)
    data.update('data', row(9)); files.write.mockResolvedValue(undefined)
    await data.saveDataset('data', writer)
    expect(data.pendingCount()).toBe(0); expect(await data.readSource('data')).toEqual([row(9)])
  })

  it('fails a corrupted managed feature as a whole instead of silently skipping rows', async () => {
    const content = JSON.parse(stringifyManagedDatasetFile([row(1)]))
    content.features.push({ ...content.features[0], id: 'bad', geometry: null })
    const result = await importGeoJson(new File([JSON.stringify(content)], 'corrupt.geojson'))
    expect(result.layers).toEqual([]); expect(result.errors[0]).toContain('geometry')
  })

  it('round-trips typed columns on an empty dataset through the writer and real GeoJSON parser', async () => {
    const fields = [{ name: 'code', type: 'string' as const, nullable: true }]
    const data = new RuntimeFeatureData(); data.setAll('empty', [])
    data.replaceEdited('empty', [], { fields })
    expect(data.pendingCount()).toBe(1); expect(await data.readSourceFields('empty')).toBeUndefined()
    files.write.mockResolvedValue(undefined)
    await data.saveDataset('empty', createGeoJsonDataWriter('D:/empty.geojson'))
    const content = files.write.mock.calls[0][1]
    expect(JSON.parse(content)['webgis:schema']).toEqual({ version: 1, fields })
    const parsed = await importGeoJson(new File([content], 'empty.geojson'))
    expect(parsed.errors).toEqual([]); expect(parsed.layers[0].fields).toEqual(fields)
    expect(parsed.layers[0].features).toEqual([]); expect(await data.readSourceFields('empty')).toEqual(fields)
    expect(data.pendingCount()).toBe(0)
  })

  it('keeps source and pending data on write failure, then acknowledges only a successful retry', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row(1)]); data.update('data', row(9))
    const cache = data.readSnapshot(), revision = data.revision, writer = createGeoJsonDataWriter('D:/copy.geojson', 'original')
    files.read.mockResolvedValue('original'); files.write.mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined)
    await expect(data.saveDataset('data', writer)).rejects.toThrow('disk full')
    expect(data.pendingCount()).toBe(1); expect(await data.readSource('data')).toEqual([row(1)])
    await data.saveDataset('data', writer)
    expect(data.pendingCount()).toBe(0); expect(await data.readSource('data')).toEqual([row(9)])
    expect(data.readSnapshot()).toBe(cache); expect(data.revision).toBe(revision)
    expect(JSON.parse(files.write.mock.calls[1][1]).features[0]).toMatchObject({ id: 'a', properties: { value: 9 } })
  })
  it('rejects external changes and pre-write cancellation without publishing or dropping the overlay', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row(1)]); data.update('data', row(9))
    const writer = createGeoJsonDataWriter('D:/copy.geojson', 'original')
    files.read.mockResolvedValue('external')
    await expect(data.saveDataset('data', writer)).rejects.toThrow('外部修改')
    const abort = new AbortController(); abort.abort()
    await expect(data.saveDataset('data', writer, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(files.write).not.toHaveBeenCalled(); expect(data.pendingCount()).toBe(1)
    expect(await data.readSource('data')).toEqual([row(1)])
  })
  it('blocks data mutation and source replacement during a write and acknowledges late cancellation', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row(1)]); data.update('data', row(9))
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve }), abort = new AbortController()
    files.write.mockImplementation(async () => { await gate; abort.abort() })
    const saving = data.saveDataset('data', createGeoJsonDataWriter('D:/copy.geojson'), abort.signal)
    expect(await data.readSource('data')).toEqual([row(1)])
    expect(() => data.update('data', row(3))).toThrow('save in progress')
    expect(() => data.replaceAll({})).toThrow('save in progress')
    expect(() => data.releaseHistory()).toThrow('save in progress')
    release(); await saving
    expect(await data.readSource('data')).toEqual([row(9)]); expect(data.pendingCount()).toBe(0)
    data.update('data', row(2)); expect(data.pendingCount()).toBe(1)
  })
})
