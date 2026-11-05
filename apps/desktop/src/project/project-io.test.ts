import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultLayerStyle, createProject, serializeProjectFile, serializeProjectSnapshot, stringifyManagedDatasetFile } from '@desktop-webgis/project'
import { createCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { getCurrentProjectPath, openSnapshotFromDisk, pickAndSaveSnapshot, setCurrentProjectPath } from './project-io'
import { pickFile, readTextFile } from '@/platform/files'

const probe = vi.hoisted(() => ({ native: false, download: vi.fn(), pick: vi.fn(), nativePick: vi.fn(), write: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => probe.native }))
vi.mock('@/platform/browser-project-files', () => ({ downloadProject: probe.download, pickBrowserProject: probe.pick }))
vi.mock('@/platform/files', () => ({ pickSaveFile: probe.nativePick, writeTextFile: probe.write, pickFile: vi.fn(), readTextFile: vi.fn() }))
vi.mock('@/engine-host/map-runtime-host', () => ({ getLiveMapState: () => null }))
vi.mock('@/engine-host/scene3d-runtime-host', () => ({ getLiveSceneCamera: () => null }))
beforeEach(() => { vi.clearAllMocks(); probe.native = false; setCurrentProjectPath(null) })

describe('project IO adapters', () => {
  it('resolves and loads a native reference-only dataset before returning the detached project', async () => {
    probe.native = true
    const project = createProject('Referenced'), content = requireMapContent(project)
    content.datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Original' },
      storage: { type: 'managed-geojson', reference: { kind: 'relative', path: 'data/points.geojson' } } }]
    content.layers = [{ id: 'layer', datasetId: 'data', name: 'Data', visible: true, editable: true, opacity: 1, style: createDefaultLayerStyle('point') }]
    const text = serializeProjectFile({ project, featuresByDataset: {} })
    const data = stringifyManagedDatasetFile([{ id: 'stable', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { code: '001' }, metadata: { sourceId: 42, importId: 'original' } }], [{ name: 'code', type: 'string', nullable: false }])
    vi.mocked(pickFile).mockResolvedValue('D:/project/main.webgis.json')
    vi.mocked(readTextFile).mockImplementation(async path => path === 'D:/project/main.webgis.json' ? text : data)
    const opened = (await openSnapshotFromDisk())!
    expect(opened.snapshot.featuresByDataset.data[0]).toMatchObject({ id: 'stable', properties: { code: '001' }, metadata: { sourceId: 42, importId: 'original' } })
    expect(requireMapContent(opened.snapshot.project).datasets[0]).toMatchObject({ storage: { reference: { kind: 'absolute', path: 'D:/project/data/points.geojson' } }, fields: [{ name: 'code', type: 'string', nullable: false }] })
    expect(readTextFile).toHaveBeenCalledWith('D:/project/data/points.geojson')
  })

  it('requires desktop for missing local references but preserves browser-readable embedded legacy data', async () => {
    const project = createProject('Legacy'), content = requireMapContent(project)
    content.datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Original' },
      storage: { type: 'managed-geojson', reference: { kind: 'relative', path: 'data.geojson' } } }]
    let text = serializeProjectFile({ project, featuresByDataset: {} })
    probe.pick.mockImplementation(async () => ({ name: 'project.webgis.json', text: async () => text }))
    await expect(openSnapshotFromDisk()).rejects.toThrow('桌面环境')
    text = serializeProjectFile({ project, featuresByDataset: { data: [{ id: 'pending', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 99 } }] } })
    expect((await openSnapshotFromDisk())!.snapshot.featuresByDataset.data[0].properties).toEqual({ value: 99 })
    expect(readTextFile).not.toHaveBeenCalled()
  })

  it('saves and reopens the new browser file format without losing embedded edits', async () => {
    const snapshot = { project: createProject('新格式'), featuresByDataset: {
      data: [{ id: 'edited', geometry: { type: 'Point' as const, coordinates: [116, 39] as [number, number] }, properties: { name: '未丢失的编辑' } }]
    } }
    requireMapContent(snapshot.project).datasets.push({ id: 'data', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } })
    requireMapContent(snapshot.project).layers.push({ id: 'layer', datasetId: 'data', name: 'Data', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') })
    await pickAndSaveSnapshot(snapshot, 'new.webgis.json')
    const json = probe.download.mock.calls[0][0]
    expect(JSON.parse(json).project).toMatchObject({ metadata: { formatVersion: 3 }, content: { kind: 'map2d' } })
    probe.pick.mockResolvedValue({ name: 'new.webgis.json', text: async () => json })
    const opened = await openSnapshotFromDisk()
    expect(opened?.snapshot.featuresByDataset).toEqual(snapshot.featuresByDataset)
    expect(opened?.snapshot.project.metadata.name).toBe('新格式')
    expect(opened?.snapshot.project.content.kind).toBe('map2d')
    expect(getCurrentProjectPath()).toBeNull()
  })
  it('saves and reopens native scene resources after Save As moves the file across drives', async () => {
    probe.native = true
    const project = createProject('New scene', 'scene3d'); project.content.scene = createCesiumScene()
    project.content.scene.assets.model = { type: 'glb', reference: { kind: 'relative', path: 'assets/tower.glb' } }
    setCurrentProjectPath('D:/scene/source.webgis.json')
    probe.nativePick.mockResolvedValue('E:/copy/main.webgis.json')
    await pickAndSaveSnapshot({ project, featuresByDataset: {} })
    const json = probe.write.mock.calls[0][1]
    expect(JSON.parse(json).project.content.kind).toBe('scene3d')
    vi.mocked(pickFile).mockResolvedValue('E:/copy/main.webgis.json')
    vi.mocked(readTextFile).mockResolvedValue(json)
    const opened = await openSnapshotFromDisk()
    expect(opened?.snapshot.project.content.kind).toBe('scene3d')
    expect(opened?.snapshot.project.content.scene?.assets.model.reference).toEqual({ kind: 'absolute', path: 'D:/scene/assets/tower.glb' })
    expect(project.content.scene.assets.model.reference).toEqual({ kind: 'relative', path: 'assets/tower.glb' })
  })
  it.each([false, true])('rejects mixed legacy files before replacing the current project (native=%s)', async native => {
    probe.native = native
    setCurrentProjectPath('D:/working/current.webgis.json')
    const json = JSON.stringify({ project: { id: 'mixed', version: 1, name: 'Mixed', crs: 'EPSG:3857',
      datasets: [], layers: [], groups: [], rootOrder: [], settings: {}, city: createCesiumScene(),
      mapState: { center: [0, 0], zoom: 8, rotation: 0 }, basemap: { type: 'osm' } }, featuresByDataset: {} })
    probe.pick.mockResolvedValue({ name: 'mixed.webgis.json', text: async () => json })
    vi.mocked(pickFile).mockResolvedValue('D:/mixed.webgis.json')
    vi.mocked(readTextFile).mockResolvedValue(json)
    await expect(openSnapshotFromDisk()).rejects.toThrow('同时包含二维与三维内容')
    expect(getCurrentProjectPath()).toBe('D:/working/current.webgis.json')
    expect(probe.write).not.toHaveBeenCalled()
    expect(probe.download).not.toHaveBeenCalled()
  })
  it('captures the old project anchor before waiting for a Save As dialog', async () => {
    probe.native = true
    setCurrentProjectPath('D:/original/main.webgis.json')
    const project = createProject('Scene', 'scene3d'); project.content.scene = createCesiumScene()
    project.content.scene.assets.model = { type: 'glb', reference: { kind: 'relative', path: '模型/tower.glb' } }
    probe.nativePick.mockImplementation(async () => {
      setCurrentProjectPath('E:/other/main.webgis.json')
      return 'F:/copy/main.webgis.json'
    })
    await pickAndSaveSnapshot({ project, featuresByDataset: {} })
    const written = JSON.parse(probe.write.mock.calls[0][1])
    expect(written.project.content.scene.assets.model.reference).toEqual({ kind: 'absolute', path: 'D:/original/模型/tower.glb' })
    expect(project.content.scene.assets.model.reference).toEqual({ kind: 'relative', path: '模型/tower.glb' })
    expect(getCurrentProjectPath()).toBe('E:/other/main.webgis.json')
  })
  it('downloads a serialized browser project without storing a fake disk path', async () => {
    const snapshot = { project: createProject(), featuresByDataset: {} }
    setCurrentProjectPath('old.webgis.json')
    await expect(pickAndSaveSnapshot(snapshot, 'scene.webgis.json')).resolves.toBe('scene.webgis.json')
    expect(probe.download).toHaveBeenCalledWith(serializeProjectFile(snapshot), 'scene.webgis.json')
    expect(getCurrentProjectPath()).toBe('old.webgis.json'); expect(probe.nativePick).not.toHaveBeenCalled()
  })
  it('opens and validates the selected file, handles cancellation, and rejects malformed projects', async () => {
    const snapshot = { project: createProject(), featuresByDataset: {} }
    probe.pick.mockResolvedValue({ name: 'scene.webgis.json', text: async () => serializeProjectSnapshot(snapshot) })
    const opened = await openSnapshotFromDisk()
    expect(opened?.snapshot).toEqual(snapshot)
    expect(opened?.migration).toBeUndefined()
    expect(getCurrentProjectPath()).toBeNull()
    probe.pick.mockResolvedValue(null); expect(await openSnapshotFromDisk()).toBeNull()
    probe.pick.mockResolvedValue({ name: 'bad.json', text: async () => '{}' })
    await expect(openSnapshotFromDisk()).rejects.toThrow()
  })
  it('keeps the native save dialog and native file writer on desktop', async () => {
    probe.native = true; probe.nativePick.mockResolvedValue('D:/scene3d.webgis.json')
    const snapshot = { project: createProject(), featuresByDataset: {} }
    expect(await pickAndSaveSnapshot(snapshot)).toBe('D:/scene3d.webgis.json')
    expect(probe.write).toHaveBeenCalledWith('D:/scene3d.webgis.json', serializeProjectFile(snapshot))
    expect(getCurrentProjectPath()).toBeNull()
    expect(probe.download).not.toHaveBeenCalled()
  })
})
