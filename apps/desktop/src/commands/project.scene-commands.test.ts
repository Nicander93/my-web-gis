import { beforeEach, expect, it, vi } from 'vitest'
import { projectCommands } from './project.commands'

const probe = vi.hoisted(() => ({ open: vi.fn(), replace: vi.fn(), status: vi.fn() }))
vi.mock('@/exchange/scene-document-io', () => ({ openSceneDocument: probe.open, saveSceneDocument: vi.fn() }))
vi.mock('@/commands/scene-document.commands', () => ({ replaceSceneDocumentAsEdit: probe.replace }))
vi.mock('@/platform/command-status', () => ({ emitCommandStatus: probe.status }))
vi.mock('@/session/project.store', () => ({ useProjectStore: { getState: () => ({ dirty: false, projectEpoch: 0 }) } }))
vi.mock('@/session/project-session', () => ({ projectSession: { getSnapshot: () => ({ project: { metadata: { id: 'original' } }, featuresByDataset: {} }) } }))
vi.mock('@/view-state/layer-view.store', () => ({ useLayerViewStore: { getState: () => ({ sessions: {} }) } }))
beforeEach(() => { projectCommands.cancelSceneImport(); vi.clearAllMocks() })

it('rejects late results from a cancelled or superseded import', async () => {
  let finishFirst!: (value: unknown) => void
  probe.open.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve }))
  const first = projectCommands.importScene()
  await Promise.resolve()
  expect(projectCommands.isImportingScene()).toBe(true)
  probe.open.mockResolvedValueOnce({ path: 'new.json', document: { id: 'new' } })
  await projectCommands.importScene()
  finishFirst({ path: 'old.json', document: { id: 'old' } })
  await first
  expect(probe.replace).toHaveBeenCalledTimes(1)
  expect(probe.replace).toHaveBeenCalledWith({ id: 'new' })
  expect(projectCommands.isImportingScene()).toBe(false)

  let finishCancelled!: (value: unknown) => void
  probe.open.mockImplementationOnce(() => new Promise(resolve => { finishCancelled = resolve }))
  const cancelled = projectCommands.importScene()
  await Promise.resolve()
  projectCommands.cancelSceneImport()
  finishCancelled({ path: 'cancelled.json', document: { id: 'cancelled' } })
  await cancelled
  expect(probe.replace).toHaveBeenCalledTimes(1)
})
