import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createProject, createDefaultLayerStyle } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { getCurrentProjectPath, setCurrentProjectPath } from './project-io'
import { discardRecoveryOnReplacement, startRecoveryTracking } from './recovery-tracking'

const probe = vi.hoisted(() => ({ write: vi.fn(), status: vi.fn(), clear: vi.fn() }))
vi.mock('./project-recovery', () => ({ projectRecovery: { write: probe.write, clearSaved: probe.clear }, recoveryOwner: (epoch: number) => `test:${epoch}` }))
vi.mock('@/features/map/map-runtime-host', () => ({ getLiveMapState: () => null }))
vi.mock('@/features/scene3d/scene3d-runtime-host', () => ({ getLiveSceneCamera: () => null }))
vi.mock('@/app/commands/status', () => ({ emitCommandStatus: probe.status }))
let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); probe.write.mockResolvedValue(undefined)
  probe.clear.mockResolvedValue(undefined)
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  const project = createProject('Tracked')
  project.datasets = [{ id: 'd', name: 'Data', kind: 'vector', source: { type: 'memory', label: 'Data' } }]
  project.layers = [{ id: 'l', datasetId: 'd', name: 'Data', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('point') }]
  useProjectStore.getState().loadSnapshot({ project, featuresByDataset: { d: [{ id: 'f', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 2 } }] } })
  setCurrentProjectPath('D:/tracked.webgis.json')
})
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })

it('coalesces applied edits, ignores table preferences and cancels pending writes after a current save', async () => {
  stop = startRecoveryTracking(50, 1000)
  useSessionStore.getState().setAttributeTableState('l', { columnWidths: { value: 234 } })
  await vi.advanceTimersByTimeAsync(100); expect(probe.write).not.toHaveBeenCalled()
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 3 })
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 4 })
  await vi.advanceTimersByTimeAsync(50)
  expect(probe.write).toHaveBeenCalledTimes(1)
  expect(probe.write.mock.calls[0][0].featuresByDataset.d[0].properties.value).toBe(4)
  expect(probe.write.mock.calls[0][1]).toBe(getCurrentProjectPath())
  expect(JSON.stringify(probe.write.mock.calls[0][0])).not.toContain('columnWidths')
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 5 })
  useProjectStore.getState().setDirty(false)
  await vi.advanceTimersByTimeAsync(1000)
  expect(probe.write).toHaveBeenCalledTimes(1)
})

it('flushes the previous project under its own epoch and writes the next project independently', async () => {
  const previousEpoch = useProjectStore.getState().projectEpoch
  stop = startRecoveryTracking(50, 1000)
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 7 })
  useProjectStore.getState().loadSnapshot({ project: createProject('Next'), featuresByDataset: {} })
  expect(probe.write).toHaveBeenCalledTimes(1)
  expect(probe.write.mock.calls[0][0].project.name).toBe('Tracked')
  expect(probe.write.mock.calls[0][1]).toBe('D:/tracked.webgis.json')
  expect(probe.write.mock.calls[0][2]).toBe(`test:${previousEpoch}`)
  useProjectStore.getState().setDirty(true)
  await vi.advanceTimersByTimeAsync(50)
  expect(probe.write.mock.calls[1][0].project.name).toBe('Next')
  expect(probe.write.mock.calls[1][1]).toBeNull()
})

it('retries failed cache IO at the configured interval without affecting document edits or history', async () => {
  probe.write.mockRejectedValueOnce(new Error('quota exceeded'))
  stop = startRecoveryTracking(50, 1000)
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 8 })
  await vi.advanceTimersByTimeAsync(50)
  expect(useProjectStore.getState().dirty).toBe(true)
  expect(probe.status).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'))
  await vi.advanceTimersByTimeAsync(950)
  expect(probe.write).toHaveBeenCalledTimes(2)
  useProjectStore.getState().undoEdit()
  expect(useProjectStore.getState().featuresByDataset.d[0].properties.value).toBe(2)
})

it('honors explicit discard on replacement but preserves edits if the replacement is cancelled', async () => {
  const epoch = useProjectStore.getState().projectEpoch
  stop = startRecoveryTracking(50, 1000)
  useProjectStore.getState().updateFeatureProperties('l', 'f', { value: 9 })
  discardRecoveryOnReplacement()
  // Picker cancellation does not load another snapshot; the current document remains dirty.
  await vi.advanceTimersByTimeAsync(50)
  expect(probe.write).toHaveBeenCalledTimes(1)
  expect(probe.clear).not.toHaveBeenCalled()
  useProjectStore.getState().loadSnapshot({ project: createProject('Next'), featuresByDataset: {} })
  expect(probe.clear).toHaveBeenCalledWith(expect.objectContaining({ featuresByDataset: expect.any(Object) }), `test:${epoch}`)
  expect(probe.write).toHaveBeenCalledTimes(1)
})
