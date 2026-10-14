import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, serializeProjectSnapshot } from '@desktop-webgis/gis-core'
import { createCityScene } from '@desktop-webgis/cesium-scene-schema'
import { getCurrentProjectPath, openSnapshotFromDisk, pickAndSaveSnapshot, setCurrentProjectPath } from './project-io'

const probe = vi.hoisted(() => ({ native: false, download: vi.fn(), pick: vi.fn(), nativePick: vi.fn(), write: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => probe.native }))
vi.mock('./browser-project-files', () => ({ downloadProject: probe.download, pickBrowserProject: probe.pick }))
vi.mock('@/services/files', () => ({ pickSaveFile: probe.nativePick, writeTextFile: probe.write, pickFile: vi.fn(), readTextFile: vi.fn() }))
vi.mock('@/features/map/map-runtime-host', () => ({ getLiveMapState: () => null }))
vi.mock('@/features/city/city-runtime-host', () => ({ getLiveCityCamera: () => null }))
beforeEach(() => { vi.clearAllMocks(); probe.native = false; setCurrentProjectPath(null) })

describe('project IO adapters', () => {
  it('captures the old project anchor before waiting for a Save As dialog', async () => {
    probe.native = true
    setCurrentProjectPath('D:/original/main.webgis.json')
    const project = createProject(); project.city = createCityScene()
    project.city.assets.model = { type: 'glb', reference: { kind: 'relative', path: '模型/tower.glb' } }
    probe.nativePick.mockImplementation(async () => {
      setCurrentProjectPath('E:/other/main.webgis.json')
      return 'F:/copy/main.webgis.json'
    })
    await pickAndSaveSnapshot({ project, featuresByDataset: {} })
    const written = JSON.parse(probe.write.mock.calls[0][1])
    expect(written.project.city.assets.model.reference).toEqual({ kind: 'absolute', path: 'D:/original/模型/tower.glb' })
    expect(project.city.assets.model.reference).toEqual({ kind: 'relative', path: '模型/tower.glb' })
    expect(getCurrentProjectPath()).toBe('E:/other/main.webgis.json')
  })
  it('downloads a serialized browser project without storing a fake disk path', async () => {
    const snapshot = { project: createProject(), featuresByDataset: {} }
    setCurrentProjectPath('old.webgis.json')
    await expect(pickAndSaveSnapshot(snapshot, 'city.webgis.json')).resolves.toBe('city.webgis.json')
    expect(probe.download).toHaveBeenCalledWith(serializeProjectSnapshot(snapshot), 'city.webgis.json')
    expect(getCurrentProjectPath()).toBe('old.webgis.json'); expect(probe.nativePick).not.toHaveBeenCalled()
  })
  it('opens and validates the selected file, handles cancellation, and rejects malformed projects', async () => {
    const snapshot = { project: createProject(), featuresByDataset: {} }
    probe.pick.mockResolvedValue({ name: 'city.webgis.json', text: async () => serializeProjectSnapshot(snapshot) })
    expect((await openSnapshotFromDisk())?.snapshot).toEqual(snapshot)
    expect(getCurrentProjectPath()).toBeNull()
    probe.pick.mockResolvedValue(null); expect(await openSnapshotFromDisk()).toBeNull()
    probe.pick.mockResolvedValue({ name: 'bad.json', text: async () => '{}' })
    await expect(openSnapshotFromDisk()).rejects.toThrow()
  })
  it('keeps the native save dialog and native file writer on desktop', async () => {
    probe.native = true; probe.nativePick.mockResolvedValue('D:/city.webgis.json')
    const snapshot = { project: createProject(), featuresByDataset: {} }
    expect(await pickAndSaveSnapshot(snapshot)).toBe('D:/city.webgis.json')
    expect(probe.write).toHaveBeenCalledWith('D:/city.webgis.json', serializeProjectSnapshot(snapshot))
    expect(getCurrentProjectPath()).toBeNull()
    expect(probe.download).not.toHaveBeenCalled()
  })
})
