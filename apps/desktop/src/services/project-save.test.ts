import { beforeEach, expect, it, vi } from 'vitest'
import { createProject, createDefaultLayerStyle } from '@desktop-webgis/gis-core'
import { createCityScene, type CityCamera } from '@desktop-webgis/cesium-scene-schema'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { useSaveStore } from '@/stores/save.store'
import { getCurrentProjectPath, setCurrentProjectPath } from './project-io'
import { requestProjectSave } from './project-save'

const probe = vi.hoisted(() => ({ write: vi.fn(), pick: vi.fn(), status: vi.fn(), camera: null as CityCamera | null }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@/services/files', () => ({ pickSaveFile: probe.pick, writeTextFile: probe.write }))
vi.mock('@/features/map/map-runtime-host', () => ({ getLiveMapState: () => null }))
vi.mock('@/features/city/city-runtime-host', () => ({ getLiveCityCamera: () => probe.camera }))
vi.mock('@/app/commands/status', () => ({ emitCommandStatus: probe.status }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks(); probe.camera = null; probe.write.mockResolvedValue(undefined); probe.pick.mockResolvedValue('D:/new.webgis.json')
  const project = createProject('Saved')
  project.datasets = [{ id: 'd', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  project.layers = [{ id: 'l', datasetId: 'd', name: 'Data', visible: true, opacity: 1, editable: false, style: createDefaultLayerStyle('point') }]
  useProjectStore.getState().loadSnapshot({ project, featuresByDataset: { d: [{ id: 'f', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 2 } }] } })
  useProjectStore.getState().setDirty(true); setCurrentProjectPath('D:/saved.webgis.json')
})

it('acknowledges only a fully matching saved version and excludes UI/session bookkeeping', async () => {
  useSessionStore.getState().setAttributeTableState('l', { columnWidths: { value: 232 } })
  expect(await requestProjectSave()).toBe(true)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(probe.write.mock.calls[0][0]).toBe('D:/saved.webgis.json')
  expect(probe.write.mock.calls[0][1]).not.toContain('columnWidths')
  expect(probe.write.mock.calls[0][1]).not.toContain('projectEpoch')
  expect(useSaveStore.getState().pending).toBe(0)
})

it('keeps new edits dirty and does not let an older completion overwrite current values', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 99 })
  gate.resolve()
  expect(await saving).toBe(false)
  expect(JSON.parse(probe.write.mock.calls[0][1]).featuresByDataset.d[0].properties.value).toBe(2)
  expect(useProjectStore.getState().featuresByDataset.d[0].properties.value).toBe(99)
  expect(useProjectStore.getState().dirty).toBe(true)
})

it('does not clear a re-opened same-ID project or adopt the old save path', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  const reopened = useProjectStore.getState().getSnapshot()
  useProjectStore.getState().loadSnapshot(reopened)
  expect(getCurrentProjectPath()).toBeNull()
  setCurrentProjectPath('D:/reopened.webgis.json'); useProjectStore.getState().setDirty(true)
  gate.resolve()
  expect(await saving).toBe(false)
  expect(getCurrentProjectPath()).toBe('D:/reopened.webgis.json')
  expect(useProjectStore.getState().dirty).toBe(true)
})

it('serializes writes and coalesces queued requests while saving the latest queued content', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const first = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 99 })
  const second = requestProjectSave(), third = requestProjectSave()
  expect(second).toBe(third); expect(probe.write).toHaveBeenCalledTimes(1)
  gate.resolve()
  expect(await first).toBe(false); expect(await second).toBe(true)
  expect(probe.write.mock.calls.map((call) => JSON.parse(call[1]).featuresByDataset.d[0].properties.value)).toEqual([2, 99])
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(useSaveStore.getState().pending).toBe(0)
})

it('leaves the old association and dirty state on cancellation or failure, and permits a retry', async () => {
  probe.pick.mockResolvedValueOnce(null)
  expect(await requestProjectSave(true)).toBe(false)
  expect(probe.write).not.toHaveBeenCalled()
  expect(getCurrentProjectPath()).toBe('D:/saved.webgis.json')
  probe.write.mockRejectedValueOnce(new Error('file locked'))
  expect(await requestProjectSave()).toBe(false)
  expect(useProjectStore.getState().dirty).toBe(true)
  expect(getCurrentProjectPath()).toBe('D:/saved.webgis.json')
  expect(await requestProjectSave()).toBe(true)
})

it('adopts a successful Save As path for the same owner but retains dirty edits made during writing', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave(true)
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 99 })
  gate.resolve(); expect(await saving).toBe(false)
  expect(getCurrentProjectPath()).toBe('D:/new.webgis.json')
  expect(useProjectStore.getState().dirty).toBe(true)
  expect(await requestProjectSave()).toBe(true)
  expect(probe.write.mock.calls[1][0]).toBe('D:/new.webgis.json')
})

it('allows selection and column changes during saving without invalidating document acknowledgement', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  useProjectStore.getState().setSelection({ layerId: 'l', featureIds: ['f'] })
  useSessionStore.getState().setAttributeTableState('l', { columnWidths: { value: 300 } })
  gate.resolve(); expect(await saving).toBe(true)
  expect(useSessionStore.getState().sessions.l.attributeTable?.columnWidths.value).toBe(300)
})

it('keeps the working file association across undoable full-scene content replacement', async () => {
  const before = useProjectStore.getState().getSnapshot(), epoch = useProjectStore.getState().projectEpoch
  const replacement = { ...before, project: { ...before.project, id: 'imported-scene', name: 'Imported' } }
  useProjectStore.getState().replaceSnapshotAsEdit(replacement, '导入完整场景')
  expect(useProjectStore.getState().projectEpoch).toBe(epoch)
  expect(getCurrentProjectPath()).toBe('D:/saved.webgis.json')
  expect(useProjectStore.getState().undoEdit()).toBe(true)
  expect(getCurrentProjectPath()).toBe('D:/saved.webgis.json')
  expect(await requestProjectSave()).toBe(true)
  expect(JSON.parse(probe.write.mock.calls[0][1]).project.id).toBe(before.project.id)
})

it('ignores only insignificant Cesium camera noise without rounding bytes written to the file', async () => {
  const snapshot = useProjectStore.getState().getSnapshot(); snapshot.project.city = createCityScene()
  useProjectStore.getState().loadSnapshot(snapshot); setCurrentProjectPath('D:/scene.webgis.json')
  useProjectStore.getState().setDirty(true); probe.camera = structuredClone(snapshot.project.city.camera)
  const original = structuredClone(probe.camera), gate = deferred()
  probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  probe.camera.heading += 3e-13; probe.camera.pitch += 5e-14; probe.camera.roll = 359.9999999999996
  probe.camera.position[2] += 5e-9
  gate.resolve(); expect(await saving).toBe(true)
  expect(JSON.parse(probe.write.mock.calls[0][1]).project.city.camera).toEqual(original)
  expect(useProjectStore.getState().dirty).toBe(false)
})

it('retains dirty when a real live-camera movement occurs during saving', async () => {
  const snapshot = useProjectStore.getState().getSnapshot(); snapshot.project.city = createCityScene()
  useProjectStore.getState().loadSnapshot(snapshot); setCurrentProjectPath('D:/scene.webgis.json')
  useProjectStore.getState().setDirty(true); probe.camera = structuredClone(snapshot.project.city.camera)
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  probe.camera.heading += .001
  gate.resolve(); expect(await saving).toBe(false)
  expect(useProjectStore.getState().dirty).toBe(true)
})

it('rejects invalid project loading before clearing existing sessions and edit history', () => {
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 99 })
  useSessionStore.getState().setAttributeTableState('l', { searchQuery: 'keep draft' })
  const before = useProjectStore.getState().getSnapshot(), epoch = useProjectStore.getState().projectEpoch
  const invalid = structuredClone(before)
  invalid.project.groups = [{ id: 'loop', name: 'Loop', visible: true, parentId: 'loop', layerIds: [] }]
  expect(() => useProjectStore.getState().loadSnapshot(invalid)).toThrow()
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  expect(useProjectStore.getState().projectEpoch).toBe(epoch)
  expect(useSessionStore.getState().sessions.l.attributeTable?.searchQuery).toBe('keep draft')
  expect(useProjectStore.getState().undoEdit()).toBe(true)
  expect(useProjectStore.getState().featuresByDataset.d[0].properties.value).toBe(2)
})
