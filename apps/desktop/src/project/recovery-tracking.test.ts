import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { featureCommands } from '@/commands/feature.commands'
import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createProject, createDefaultLayerStyle } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { getCurrentProjectPath, setCurrentProjectPath } from './project-io'
import { discardRecoveryOnReplacement, startRecoveryTracking } from './recovery-tracking'

const probe = vi.hoisted(() => ({ write: vi.fn(), status: vi.fn(), clear: vi.fn() }))
vi.mock('./project-recovery', () => ({ projectRecovery: { write: probe.write, clearSaved: probe.clear }, recoveryOwner: (epoch: number) => `test:${epoch}` }))
vi.mock('@/engine-host/map-runtime-host', () => ({ getLiveMapState: () => null }))
vi.mock('@/engine-host/scene3d-runtime-host', () => ({ getLiveSceneCamera: () => null }))
vi.mock('@/platform/command-status', () => ({ emitCommandStatus: probe.status }))
let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); probe.write.mockResolvedValue(undefined)
  probe.clear.mockResolvedValue(undefined)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  const project = createProject('Tracked')
  requireMapContent(project).datasets = [{ id: 'd', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  requireMapContent(project).layers = [{ id: 'l', datasetId: 'd', name: 'Data', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
  projectSession.loadSnapshot({ project, featuresByDataset: { d: [{ id: 'f', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 2 } }] } })
  setCurrentProjectPath('D:/tracked.webgis.json')
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })

it('coalesces applied edits, 忽略s table preferences and keeps drafting while data remains pending', async () => {
  stop = startRecoveryTracking(50, 1000)
  useLayerViewStore.getState().setAttributeTableState('l', { columnWidths: { value: 234 } })
  await vi.advanceTimersByTimeAsync(100); expect(probe.write).not.toHaveBeenCalled()
  featureCommands.updateProperties('l', 'f', { value: 3 })
  featureCommands.updateProperties('l', 'f', { value: 4 })
  await vi.advanceTimersByTimeAsync(50)
  expect(probe.write).toHaveBeenCalledTimes(1)
  expect(probe.write.mock.calls[0][0].featuresByDataset.d[0].properties.value).toBe(4)
  expect(probe.write.mock.calls[0][4].d.pending.updates[0].properties.value).toBe(4)
  expect(probe.write.mock.calls[0][1]).toBe(getCurrentProjectPath())
  expect(JSON.stringify(probe.write.mock.calls[0][0])).not.toContain('columnWidths')
  expect(useProjectStore.getState().dirty).toBe(false)
  featureCommands.updateProperties('l', 'f', { value: 5 })
  await vi.advanceTimersByTimeAsync(50)
  expect(probe.write).toHaveBeenCalledTimes(2)
  projectEdits.undo(); projectEdits.undo(); projectEdits.undo()
  expect(featureData.pendingCount()).toBe(0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(probe.write).toHaveBeenCalledTimes(2)
})

it('flushes the previous project under its own epoch and writes the next project independently', async () => {
  const previousEpoch = useProjectStore.getState().projectEpoch
  stop = startRecoveryTracking(50, 1000)
  featureCommands.updateProperties('l', 'f', { value: 7 })
  projectSession.loadSnapshot({ project: createProject('Next'), featuresByDataset: {} })
  expect(probe.write).toHaveBeenCalledTimes(1)
  expect(probe.write.mock.calls[0][0].project.metadata.name).toBe('Tracked')
  expect(probe.write.mock.calls[0][0].featuresByDataset.d[0].properties.value).toBe(7)
  expect(probe.write.mock.calls[0][1]).toBe('D:/tracked.webgis.json')
  expect(probe.write.mock.calls[0][2]).toBe(`test:${previousEpoch}`)
  useProjectStore.getState().setDirty(true)
  await vi.advanceTimersByTimeAsync(50)
  expect(probe.write.mock.calls[1][0].project.metadata.name).toBe('Next')
  expect(probe.write.mock.calls[1][0].featuresByDataset).toEqual({})
  expect(probe.write.mock.calls[1][1]).toBeNull()
})

it('retries failed cache IO at the configured interval without affecting document edits or history', async () => {
  probe.write.mockRejectedValueOnce(new Error('quota exceeded'))
  stop = startRecoveryTracking(50, 1000)
  featureCommands.updateProperties('l', 'f', { value: 8 })
  await vi.advanceTimersByTimeAsync(50)
  expect(useProjectStore.getState().dirty).toBe(false)
  expect(featureData.getEditState().unsavedCount).toBe(1)
  expect(probe.status).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'))
  await vi.advanceTimersByTimeAsync(950)
  expect(probe.write).toHaveBeenCalledTimes(2)
  projectEdits.undo()
  expect(featureData.readSnapshot().d[0].properties.value).toBe(2)
})

it('honors explicit discard on replacement but preserves edits if the replacement is cancelled', async () => {
  const epoch = useProjectStore.getState().projectEpoch
  stop = startRecoveryTracking(50, 1000)
  featureCommands.updateProperties('l', 'f', { value: 9 })
  discardRecoveryOnReplacement()
  // 取消文件选择不会加载另一份快照；当前文档仍然保持有未保存修改。
  await vi.advanceTimersByTimeAsync(50)
  expect(probe.write).toHaveBeenCalledTimes(1)
  expect(probe.clear).not.toHaveBeenCalled()
  projectSession.loadSnapshot({ project: createProject('Next'), featuresByDataset: {} })
  expect(probe.clear).toHaveBeenCalledWith(expect.objectContaining({ featuresByDataset: expect.any(Object) }), `test:${epoch}`)
  expect(probe.write).toHaveBeenCalledTimes(1)
})
