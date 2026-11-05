import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { featureCommands } from '@/commands/feature.commands'
import { featureData } from '@/project/datasets/feature-data'
import { selectionCommands } from '@/commands/selection.commands'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, expect, it, vi } from 'vitest'
import { createProject, createDefaultLayerStyle, SetCesiumSceneCommand } from '@desktop-webgis/project'
import { createCesiumScene, type CesiumSceneCamera } from '@desktop-webgis/cesium-scene-schema'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useSaveStore } from '@/project/save.store'
import { getCurrentProjectPath, setCurrentProjectPath } from './project-io'
import { requestProjectSave } from './project-save'

const probe = vi.hoisted(() => ({ write: vi.fn(), pick: vi.fn(), status: vi.fn(), cleanup: vi.fn(), camera: null as CesiumSceneCamera | null }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@/platform/files', () => ({ pickSaveFile: probe.pick, writeTextFile: probe.write }))
vi.mock('@/engine-host/map-runtime-host', () => ({ getLiveMapState: () => null }))
vi.mock('@/engine-host/scene3d-runtime-host', () => ({ getLiveSceneCamera: () => probe.camera }))
vi.mock('@/platform/command-status', () => ({ emitCommandStatus: probe.status }))
vi.mock('./project-recovery', () => ({ projectRecovery: { clearSaved: probe.cleanup }, recoveryOwner: (epoch: number) => `test:${epoch}` }))

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks(); probe.write.mockReset(); probe.pick.mockReset(); probe.cleanup.mockReset(); probe.status.mockReset()
  probe.camera = null; probe.write.mockResolvedValue(undefined); probe.pick.mockResolvedValue('D:/new.webgis.json')
  probe.cleanup.mockResolvedValue(undefined)
  const project = createProject('Saved')
  requireMapContent(project).datasets = [{ id: 'd', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  requireMapContent(project).layers = [{ id: 'l', datasetId: 'd', name: 'Data', visible: true, opacity: 1, editable: false, style: createDefaultLayerStyle('point') }]
  projectSession.loadSnapshot({ project, featuresByDataset: { d: [{ id: 'f', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 2 } }] } })
  useProjectStore.getState().setDirty(true); setCurrentProjectPath('D:/saved.webgis.json')
})

it('acknowledges only a fully matching saved version and excludes UI/session bookkeeping', async () => {
  useLayerViewStore.getState().setAttributeTableState('l', { columnWidths: { value: 232 } })
  expect(await requestProjectSave()).toBe(true)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(probe.write.mock.calls[0][0]).toBe('D:/saved.webgis.json')
  expect(probe.write.mock.calls[0][1]).not.toContain('columnWidths')
  expect(probe.write.mock.calls[0][1]).not.toContain('projectEpoch')
  expect(useSaveStore.getState().pending).toBe(0)
})

it('keeps Provider baselines in the project file and leaves data pending after configuration save', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  featureCommands.updateProperties('l', 'f', { value: 99 })
  gate.resolve()
  expect(await saving).toBe(true)
  expect(JSON.parse(probe.write.mock.calls[0][1]).featuresByDataset.d[0].properties.value).toBe(2)
  expect(featureData.readSnapshot().d[0].properties.value).toBe(99)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(featureData.pendingCount()).toBe(1)
  expect(probe.cleanup).not.toHaveBeenCalled()
  expect(probe.status).toHaveBeenCalledWith(expect.stringContaining('数据编辑尚未提交'))
})

it('does not clear recovery while data remains pending after a configuration acknowledgement', async () => {
  const gate = deferred(); probe.cleanup.mockImplementationOnce(() => gate.promise)
  featureCommands.updateProperties('l', 'f', { value: 88 })
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalled())
  gate.resolve()
  expect(await saving).toBe(true)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(featureData.readSnapshot().d[0].properties.value).toBe(88)
  expect(probe.cleanup).not.toHaveBeenCalled()
})

it('reports recovery cleanup failure while preserving the successful formal save', async () => {
  expect(featureData.getEditState().unsavedCount).toBe(0)
  probe.cleanup.mockRejectedValueOnce(new Error('cache locked'))
  expect(await requestProjectSave()).toBe(true)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(probe.cleanup).toHaveBeenCalled()
  expect(probe.status).toHaveBeenLastCalledWith(expect.stringContaining('恢复草稿清理失败'))
})

it('does not clear a re-opened same-ID project or adopt the old save path', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  const reopened = projectSession.getSnapshot()
  projectSession.loadSnapshot(reopened)
  expect(getCurrentProjectPath()).toBeNull()
  setCurrentProjectPath('D:/reopened.webgis.json'); useProjectStore.getState().setDirty(true)
  gate.resolve()
  expect(await saving).toBe(false)
  expect(getCurrentProjectPath()).toBe('D:/reopened.webgis.json')
  expect(useProjectStore.getState().dirty).toBe(true)
})

it('serializes writes and coalesces queued requests while saving the latest queued content', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const { layerConfigurationCommands } = await import('@/commands/layer-configuration.commands')
  const first = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  featureCommands.updateProperties('l', 'f', { value: 99 })
  layerConfigurationCommands.renameLayer('l', 'Queued')
  const second = requestProjectSave(), third = requestProjectSave()
  expect(second).toBe(third); expect(probe.write).toHaveBeenCalledTimes(1)
  gate.resolve()
  expect(await first).toBe(false); expect(await second).toBe(true)
  expect(probe.write.mock.calls.map((call) => JSON.parse(call[1]).project.content.layers[0].name)).toEqual(['Data', 'Queued'])
  expect(JSON.parse(probe.write.mock.calls[1][1]).featuresByDataset.d[0].properties.value).toBe(2)
  expect(featureData.pendingCount()).toBe(1)
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

it('adopts a successful Save As path for the same owner; data edits during writing stay pending without configuration dirty', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave(true)
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  featureCommands.updateProperties('l', 'f', { value: 99 })
  gate.resolve(); expect(await saving).toBe(true)
  expect(getCurrentProjectPath()).toBe('D:/new.webgis.json')
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(featureData.pendingCount()).toBe(1)
  expect(await requestProjectSave()).toBe(true)
  expect(probe.write.mock.calls[1][0]).toBe('D:/new.webgis.json')
})

it('allows selection and column changes during saving without invalidating document acknowledgement', async () => {
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  selectionCommands.setSelection({ layerId: 'l', featureIds: ['f'] })
  useLayerViewStore.getState().setAttributeTableState('l', { columnWidths: { value: 300 } })
  gate.resolve(); expect(await saving).toBe(true)
  expect(useLayerViewStore.getState().sessions.l.attributeTable?.columnWidths.value).toBe(300)
})

it('keeps the working file association across undoable full-scene content replacement', async () => {
  const before = projectSession.getSnapshot(), epoch = useProjectStore.getState().projectEpoch
  const replacement = { ...before, project: { ...before.project, metadata: { ...before.project.metadata, id: 'imported-scene', name: 'Imported' } } }
  projectSession.replaceSnapshotAsEdit(replacement, '导入完整场景')
  expect(useProjectStore.getState().projectEpoch).toBe(epoch)
  expect(getCurrentProjectPath()).toBe('D:/saved.webgis.json')
  expect(projectEdits.undo()).toBe(true)
  expect(getCurrentProjectPath()).toBe('D:/saved.webgis.json')
  expect(await requestProjectSave()).toBe(true)
  expect(JSON.parse(probe.write.mock.calls[0][1]).project.metadata.id).toBe(before.project.metadata.id)
})

it('saves configured camera bytes while ignoring runtime camera noise', async () => {
  const snapshot = { project: createProject('Scene', 'scene3d'), featuresByDataset: {} }; snapshot.project.content.scene = createCesiumScene()
  projectSession.loadSnapshot(snapshot); setCurrentProjectPath('D:/scene.webgis.json')
  useProjectStore.getState().setDirty(true); probe.camera = structuredClone(snapshot.project.content.scene.camera)
  const original = structuredClone(probe.camera), gate = deferred()
  probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  probe.camera.heading += 3e-13; probe.camera.pitch += 5e-14; probe.camera.roll = 359.9999999999996
  probe.camera.position[2] += 5e-9
  gate.resolve(); expect(await saving).toBe(true)
  expect(JSON.parse(probe.write.mock.calls[0][1]).project.content.scene.camera).toEqual(original)
  expect(useProjectStore.getState().dirty).toBe(false)
})

it('acknowledges a save when only runtime camera navigation changes during writing', async () => {
  const snapshot = { project: createProject('Scene', 'scene3d'), featuresByDataset: {} }; snapshot.project.content.scene = createCesiumScene()
  projectSession.loadSnapshot(snapshot); setCurrentProjectPath('D:/scene.webgis.json')
  useProjectStore.getState().setDirty(true); probe.camera = structuredClone(snapshot.project.content.scene.camera)
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  probe.camera.heading += .001
  gate.resolve(); expect(await saving).toBe(true)
  expect(useProjectStore.getState().dirty).toBe(false)
})

it('retains dirty when an explicit initial-camera configuration edit occurs during writing', async () => {
  const project = createProject('Scene', 'scene3d'), scene = createCesiumScene()
  project.content.scene = scene
  projectSession.loadSnapshot({ project, featuresByDataset: {} }); setCurrentProjectPath('D:/scene.webgis.json')
  const gate = deferred(); probe.write.mockImplementationOnce(() => gate.promise)
  const saving = requestProjectSave()
  await vi.waitFor(() => expect(probe.write).toHaveBeenCalledTimes(1))
  const next = structuredClone(scene); next.camera.heading += .001
  projectEdits.execute(new SetCesiumSceneCommand('camera-preset', '设置初始视角', scene, next))
  gate.resolve(); expect(await saving).toBe(false)
  expect(useProjectStore.getState().dirty).toBe(true)
  expect(JSON.parse(probe.write.mock.calls[0][1]).project.content.scene.camera).toEqual(scene.camera)
})

it('rejects mixed installation and refuses unsafe saving of injected corrupt content', async () => {
  const snapshot = projectSession.getSnapshot()
  snapshot.project.content.scene = createCesiumScene()
  const current = projectSession.getSnapshot()
  expect(() => projectSession.loadSnapshot(snapshot)).toThrow('同时包含二维与三维内容')
  expect(projectSession.getSnapshot()).toEqual(current)
  // 故障注入绕过领域 API，用来验证独立的磁盘写入守卫。
  useProjectStore.setState({ project: snapshot.project }); featureData.replaceAll(snapshot.featuresByDataset)
  setCurrentProjectPath('D:/mixed.webgis.json')
  useProjectStore.getState().setDirty(true)
  const before = projectSession.getSnapshot()
  expect(await requestProjectSave()).toBe(false)
  expect(probe.write).not.toHaveBeenCalled()
  expect(probe.cleanup).not.toHaveBeenCalled()
  expect(probe.status).toHaveBeenCalledWith(expect.stringContaining('同时包含二维与三维内容'))
  expect(projectSession.getSnapshot()).toEqual(before)
  expect(useProjectStore.getState().dirty).toBe(true)
  expect(getCurrentProjectPath()).toBe('D:/mixed.webgis.json')
})

it('rejects invalid project loading before clearing existing sessions and edit history', () => {
  featureCommands.updateProperties('l', 'f', { value: 99 })
  useLayerViewStore.getState().setAttributeTableState('l', { searchQuery: 'keep draft' })
  const before = projectSession.getSnapshot(), epoch = useProjectStore.getState().projectEpoch
  const invalid = structuredClone(before)
  requireMapContent(invalid.project).groups = [{ id: 'loop', name: 'Loop', visible: true, parentId: 'loop', layerIds: [] }]
  expect(() => projectSession.loadSnapshot(invalid)).toThrow()
  expect(projectSession.getSnapshot()).toEqual(before)
  expect(useProjectStore.getState().projectEpoch).toBe(epoch)
  expect(useLayerViewStore.getState().sessions.l.attributeTable?.searchQuery).toBe('keep draft')
  expect(projectEdits.undo()).toBe(true)
  expect(featureData.readSnapshot().d[0].properties.value).toBe(2)
})
