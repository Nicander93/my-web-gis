import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, serializeProjectSnapshot } from '@desktop-webgis/gis-core'
import { getCurrentProjectPath, openSnapshotFromDisk, pickAndSaveSnapshot, setCurrentProjectPath } from './project-io'

const probe = vi.hoisted(() => ({ native: false, download: vi.fn(), pick: vi.fn(), nativePick: vi.fn(), write: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => probe.native }))
vi.mock('./browser-project-files', () => ({ downloadProject: probe.download, pickBrowserProject: probe.pick }))
vi.mock('@/services/files', () => ({ pickSaveFile: probe.nativePick, writeTextFile: probe.write, pickFile: vi.fn(), readTextFile: vi.fn() }))
vi.mock('@/features/map/map-runtime-host', () => ({ getLiveMapState: () => null }))
beforeEach(() => { vi.clearAllMocks(); probe.native = false; setCurrentProjectPath(null) })

describe('project IO adapters', () => {
  it('downloads a serialized browser project without storing a fake disk path', async () => {
    const snapshot = { project: createProject(), featuresByDataset: {} }
    setCurrentProjectPath('old.webgis.json')
    await expect(pickAndSaveSnapshot(snapshot, 'city.webgis.json')).resolves.toBe('city.webgis.json')
    expect(probe.download).toHaveBeenCalledWith(serializeProjectSnapshot(snapshot), 'city.webgis.json')
    expect(getCurrentProjectPath()).toBeNull(); expect(probe.nativePick).not.toHaveBeenCalled()
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
    expect(getCurrentProjectPath()).toBe('D:/city.webgis.json')
    expect(probe.download).not.toHaveBeenCalled()
  })
})
