import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLayerStyle, createProject, parseProjectFileSnapshot, readManagedDatasetFile, requireMapContent,
  serializeProjectFile, stringifyManagedDatasetFile, type ProjectSnapshot } from '@desktop-webgis/project'
import { featureCommands } from '@/commands/feature.commands'
import { useProjectStore } from '@/project/project.store'
import { projectSession } from './project-session'
import { featureData } from '@/project/datasets/feature-data'
import { projectEdits } from './project-edits'
import { bindExistingDatasetStorage, createDatasetStorage, saveBoundDataset } from './dataset-storage'
import { loadDatasetReferences } from '@/project/datasets/dataset-reference-load'
import { prepareProjectResourceReferences, resolveProjectResourceReferences } from './project-resource-references'

const io = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), write: vi.fn(), status: vi.fn(), disk: new Map<string, string>() }))
vi.mock('@/platform/files', () => ({ createTextFile: io.create, readTextFile: io.read, writeTextFile: io.write }))
vi.mock('@/platform/command-status', () => ({ emitCommandStatus: io.status }))
const path = 'D:/project/data/managed.geojson'
function fixture(): ProjectSnapshot {
  const project = createProject('Storage'), content = requireMapContent(project)
  content.datasets = [{ id: 'data', name: 'Data', kind: 'vector', fields: [{ name: 'value', type: 'number', nullable: false }], source: { type: 'geojson-file', path: 'D:/original.geojson' } }]
  content.layers = [{ id: 'layer', datasetId: 'data', name: 'Data', visible: true, editable: true, opacity: 1, style: createDefaultLayerStyle('point') }]
  return { project, featuresByDataset: { data: [{ id: 'row', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 1 }, metadata: { sourceId: 42, sourceCrs: 'EPSG:3857', importId: 'origin' } }] } }
}
function storage() {
  const dataset = requireMapContent(useProjectStore.getState().project).datasets[0]
  return dataset.kind === 'vector' ? dataset.storage : undefined
}
beforeEach(() => {
  io.disk.clear(); io.create.mockReset(); io.read.mockReset(); io.write.mockReset(); io.status.mockReset()
  io.create.mockImplementation(async (name: string, content: string) => { if (io.disk.has(name)) throw new Error('already exists'); io.disk.set(name, content) })
  io.read.mockImplementation(async (name: string) => { if (!io.disk.has(name)) throw new Error('file missing'); return io.disk.get(name)! })
  io.write.mockImplementation(async (name: string, content: string) => { io.disk.set(name, content) })
  projectSession.loadSnapshot(fixture())
})

describe('explicit managed dataset target lifecycle', () => {
  it('creates the original source first, preserves pending edits, and saves data without changing configuration', async () => {
    featureCommands.updateProperties('layer', 'row', { value: 9 })
    const source = featureData.getSessionIdentity('data')
    await createDatasetStorage('data', path)
    expect(readManagedDatasetFile(io.disk.get(path)!).features[0].properties).toEqual({ value: 1 })
    expect(storage()).toEqual({ type: 'managed-geojson', reference: { kind: 'absolute', path } })
    expect(featureData.pendingCount()).toBe(1)
    const configuration = useProjectStore.getState()
    expect(await saveBoundDataset('data')).toBe(true)
    expect(useProjectStore.getState().project).toBe(configuration.project)
    expect(useProjectStore.getState().configRevision).toBe(configuration.configRevision)
    expect(useProjectStore.getState().dirty).toBe(configuration.dirty)
    expect(featureData.getSessionIdentity('data')).toBe(source)
    expect(featureData.pendingCount()).toBe(0)
    expect(readManagedDatasetFile(io.disk.get(path)!).features[0]).toMatchObject({ properties: { value: 9 }, metadata: { sourceId: 42 } })
    expect(requireMapContent(useProjectStore.getState().project).datasets[0].source).toEqual({ type: 'geojson-file', path: 'D:/original.geojson' })
    expect(projectEdits.undo()).toBe(true); expect(storage()).toBeUndefined()
    expect(featureData.getAll('data')[0].properties.value).toBe(9)
    expect(projectEdits.redo()).toBe(true); expect(storage()!.reference).toEqual({ kind: 'absolute', path })
  })

  it('reopens a reference-only project through relative paths and saves again with original provenance intact', async () => {
    await createDatasetStorage('data', path)
    featureCommands.updateProperties('layer', 'row', { value: 9 }); await saveBoundDataset('data')
    const referenceOnly = { project: projectSession.getSnapshot().project, featuresByDataset: {} }
    const diskSnapshot = prepareProjectResourceReferences(referenceOnly, null, 'D:/project/main.webgis.json')
    const diskDataset = requireMapContent(diskSnapshot.project).datasets[0]
    expect(diskDataset.kind === 'vector' && diskDataset.storage!.reference).toEqual({ kind: 'relative', path: 'data/managed.geojson' })
    const parsed = parseProjectFileSnapshot(serializeProjectFile(diskSnapshot))
    const loaded = await loadDatasetReferences(resolveProjectResourceReferences(parsed, 'D:/project/main.webgis.json'))
    projectSession.loadSnapshot(loaded)
    expect(featureData.pendingCount()).toBe(0)
    expect(featureData.getAll('data')[0]).toMatchObject({ id: 'row', properties: { value: 9 }, metadata: { sourceId: 42, sourceCrs: 'EPSG:3857', importId: 'origin' } })
    featureCommands.updateProperties('layer', 'row', { value: 12 })
    expect(await saveBoundDataset('data')).toBe(true)
    expect(readManagedDatasetFile(io.disk.get(path)!).features[0].properties.value).toBe(12)
  })

  it('never overwrites an existing destination during creation', async () => {
    io.disk.set(path, 'user-owned data'); featureCommands.updateProperties('layer', 'row', { value: 9 })
    await expect(createDatasetStorage('data', path)).rejects.toThrow('already exists')
    expect(io.disk.get(path)).toBe('user-owned data'); expect(storage()).toBeUndefined()
    expect(featureData.pendingCount()).toBe(1)
    expect((await featureData.readSource('data'))[0].properties.value).toBe(1)
  })

  it('adopts a matching managed file but refuses different originals or external modifications', async () => {
    io.disk.set(path, stringifyManagedDatasetFile(fixture().featuresByDataset.data, requireMapContent(fixture().project).datasets[0].fields))
    await bindExistingDatasetStorage('data', path)
    featureCommands.updateProperties('layer', 'row', { value: 9 })
    const changed = fixture().featuresByDataset.data; changed[0].properties.value = 20
    io.disk.set(path, stringifyManagedDatasetFile(changed, requireMapContent(fixture().project).datasets[0].fields))
    await expect(saveBoundDataset('data')).rejects.toThrow('外部修改')
    expect(io.write).not.toHaveBeenCalled(); expect(featureData.pendingCount()).toBe(1)
    projectEdits.undo(); projectEdits.undo()
    await expect(bindExistingDatasetStorage('data', path)).rejects.toThrow('不一致')
    expect(storage()).toBeUndefined()
  })

  it('preserves legacy embedded edits and stages failed reference reads without changing the workspace', async () => {
    await createDatasetStorage('data', path)
    const legacy = projectSession.getSnapshot(); legacy.featuresByDataset.data[0].properties.value = 99
    io.read.mockClear()
    expect((await loadDatasetReferences(legacy)).featuresByDataset.data[0].properties.value).toBe(99)
    expect(io.read).not.toHaveBeenCalled()
    const referenceOnly = { project: legacy.project, featuresByDataset: {} }, before = projectSession.getSnapshot()
    io.disk.set(path, 'corrupt')
    await expect(loadDatasetReferences(referenceOnly)).rejects.toThrow()
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(referenceOnly.featuresByDataset).toEqual({})
  })

  it('keeps edits made while target creation waits and refuses stale binding after a project switch', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    io.create.mockImplementationOnce(async (name: string, content: string) => { await gate; io.disk.set(name, content) })
    const creating = createDatasetStorage('data', path)
    await vi.waitFor(() => expect(io.create).toHaveBeenCalled())
    featureCommands.updateProperties('layer', 'row', { value: 9 }); release(); await creating
    expect(featureData.getAll('data')[0].properties.value).toBe(9); expect(featureData.pendingCount()).toBe(1)
    expect(readManagedDatasetFile(io.disk.get(path)!).features[0].properties.value).toBe(1)
    let finish!: () => void
    io.create.mockImplementationOnce(async (name: string, content: string) => { await new Promise<void>(resolve => { finish = resolve }); io.disk.set(name, content) })
    const stale = createDatasetStorage('data', 'D:/project/stale.geojson')
    await vi.waitFor(() => expect(io.create).toHaveBeenCalledTimes(2))
    const next = fixture(); next.project.metadata.id = 'next'; next.featuresByDataset.data[0].properties.value = 100
    projectSession.loadSnapshot(next); finish()
    await expect(stale).rejects.toThrow('已创建但尚未绑定')
    expect(storage()).toBeUndefined(); expect(featureData.getAll('data')[0].properties.value).toBe(100)
    expect(io.disk.has('D:/project/stale.geojson')).toBe(true)
  })

  it('blocks target undo during publication, then releases the block after a failed save', async () => {
    featureCommands.updateProperties('layer', 'row', { value: 9 }); await createDatasetStorage('data', path)
    let fail!: (error: Error) => void
    io.write.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject }))
    const saving = saveBoundDataset('data')
    await vi.waitFor(() => expect(io.write).toHaveBeenCalled())
    expect(projectEdits.undo()).toBe(false); expect(storage()).toBeDefined()
    expect(io.status).toHaveBeenCalledWith('数据保存进行中，不能更改源或保存目标')
    const rejected = expect(saving).rejects.toThrow('disk full'); fail(new Error('disk full')); await rejected
    expect(projectEdits.undo()).toBe(true); expect(storage()).toBeUndefined()
    expect(featureData.pendingCount()).toBe(1)
  })
})
