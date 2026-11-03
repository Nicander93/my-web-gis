import { describe, expect, it, vi } from 'vitest'
import { createProject, MemoryFeatureProvider, requireMapContent, SetDatasetContentCommand, type GisFeature } from '@desktop-webgis/project'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { featureCommands } from '@/commands/feature.commands'
import { prepareFieldSchemaEdit } from '@/features/attribute-table/field-schema-edits'
import { useProjectStore } from '@/session/project.store'
import { RuntimeFeatureData } from './feature-data-runtime'
import { featureData } from './feature-data'
import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { commitDatasetEdits } from '@/session/data-save'

const row = (value = 1): GisFeature => ({ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value } })

describe('runtime pending and save lifecycle subscriptions', () => {
  it('publishes once after an outer transaction and leaves state untouched on rollback', () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row()])
    const initial = data.getEditState(), listener = vi.fn(), stop = data.subscribeEdits(listener)
    data.transaction(() => { data.update('data', row(2)); data.update('data', row(3)); expect(listener).not.toHaveBeenCalled() })
    expect(listener).toHaveBeenCalledTimes(1)
    const committed = data.getEditState()
    expect(committed.pendingCount).toBe(1); expect(initial.pendingCount).toBe(0)
    expect(() => data.transaction(() => { data.update('data', row(4)); throw new Error('rollback') })).toThrow('rollback')
    expect(data.getEditState()).toBe(committed); expect(listener).toHaveBeenCalledTimes(1)
    expect(data.getAll('data')).toEqual([row(3)])
    stop(); data.update('data', row(5)); expect(listener).toHaveBeenCalledTimes(1)
  })

  it('observes same-count edits and schema-only changes through immutable metadata snapshots', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row()]); data.setAll('empty', [])
    const empty = data.getEditState().datasets.find(dataset => dataset.datasetId === 'empty')
    data.update('data', row(2)); const before = data.getEditState()
    expect(data.getEditState().datasets.find(dataset => dataset.datasetId === 'empty')).toBe(empty)
    data.update('data', row(3)); expect(data.getEditState().revision).toBeGreaterThan(before.revision)
    expect(data.getEditState().pendingCount).toBe(before.pendingCount)
    data.replaceEdited('empty', [], { fields: [{ name: 'code', type: 'string', nullable: true }] })
    expect(data.getEditState().datasets.find(dataset => dataset.datasetId === 'empty')!.pendingCount).toBe(1)
    expect(Object.isFrozen(data.getEditState())).toBe(true)
    expect(Object.isFrozen(data.getEditState().datasets)).toBe(true)
    expect(Object.isFrozen(data.getEditState().datasets[0])).toBe(true)
    await data.saveDataset('empty', async () => {})
    expect(data.getEditState().datasets.find(dataset => dataset.datasetId === 'empty')).toMatchObject({ pendingCount: 0, sourceRevision: 1, saving: false })
  })

  it('publishes save completion without changing the row cache or reading full Provider rows', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row()]); data.update('data', row(2))
    const cache = data.readSnapshot(), revision = data.revision, rows = vi.fn(), edits = vi.fn()
    const stopRows = data.subscribe(rows), stopEdits = data.subscribeEdits(edits)
    const fullRows = vi.spyOn(MemoryFeatureProvider.prototype, 'getLoadedRows').mockImplementation(() => { throw new Error('full rows forbidden') })
    try {
      await data.saveDataset('data', async () => {})
      expect(edits).toHaveBeenCalledTimes(2); expect(rows).not.toHaveBeenCalled()
      expect(data.readSnapshot()).toBe(cache); expect(data.revision).toBe(revision)
      expect(data.getEditState()).toMatchObject({ pendingCount: 0, saving: false })
      expect(data.getEditState().datasets[0].sourceRevision).toBe(1)
    } finally { fullRows.mockRestore(); stopRows(); stopEdits() }
  })

  it('keeps pending state on failed acknowledgement and releases saving status for retry', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row()]); data.update('data', row(2))
    let fail!: (error: Error) => void
    const states: boolean[] = [], stop = data.subscribeEdits(() => states.push(data.getEditState().saving))
    const saving = data.saveDataset('data', () => new Promise<void>((_resolve, reject) => { fail = reject }))
    expect(data.getEditState()).toMatchObject({ pendingCount: 1, saving: true })
    expect(() => data.clear('data')).toThrow('save in progress')
    const rejected = expect(saving).rejects.toThrow('disk'); fail(new Error('disk')); await rejected
    expect(states).toEqual([true, false]); expect(data.getEditState().pendingCount).toBe(1)
    expect(data.getEditState().datasets[0].sourceRevision).toBe(0)
    await data.saveDataset('data', async () => {}); expect(data.getEditState().pendingCount).toBe(0)
    stop()
  })

  it('tracks active owners and restores pending state without confusing a replacement generation', () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row()]); data.update('data', row(2))
    const original = data.getEditState().datasets[0].sourceIdentity
    data.clear('data'); expect(data.getEditState().datasets).toEqual([])
    data.setAll('data', [row(2)])
    expect(data.getEditState().datasets[0].sourceIdentity).toBe(original)
    expect(data.getEditState().datasets[0].pendingCount).toBe(1)
    data.replaceAll({ data: [row(3)] })
    expect(data.getEditState().datasets[0].sourceIdentity).not.toBe(original)
    expect(data.getEditState().pendingCount).toBe(0)
    expect(data.getEditState().unsavedCount).toBe(0)
    expect(data.getEditState().retained).toEqual([])
  })

  it('does not treat a saved active source as clean while a replaced source still has pending', async () => {
    const data = new RuntimeFeatureData(), key = {}
    data.setAll('data', [row()]); data.update('data', row(2))
    const before = data.getEditState()
    expect(() => data.transaction(() => { data.replaceHistorySnapshot({ data: [row(9)] }, {}, 'after'); throw new Error('rollback') })).toThrow('rollback')
    expect(data.getEditState()).toBe(before)
    const sourceA = before.datasets[0].sourceIdentity
    data.replaceHistorySnapshot({ data: [row(3)] }, key, 'after')
    data.update('data', row(4)); await data.saveDataset('data', async () => {})
    const saved = data.getEditState()
    expect(saved.pendingCount).toBe(0); expect(saved.datasets[0].pendingCount).toBe(0); expect(saved.saving).toBe(false)
    expect(saved.unsavedCount).toBe(1)
    expect(saved.retained).toEqual([expect.objectContaining({ datasetId: 'data', sourceIdentity: sourceA, pendingCount: 1 })])
    expect(Object.isFrozen(saved.retained)).toBe(true); expect(Object.isFrozen(saved.retained[0])).toBe(true)
    expect(saved.datasets[0].sourceIdentity).not.toBe(sourceA)
    data.update('data', row(5))
    expect(data.getEditState().retained[0]).toBe(saved.retained[0]); expect(data.getEditState().unsavedCount).toBe(2)
    await data.saveDataset('data', async () => {}); expect(data.getEditState().retained[0]).toBe(saved.retained[0])
    data.replaceHistorySnapshot({ data: [row(2)] }, key, 'before')
    expect(data.getEditState().datasets[0].sourceIdentity).toBe(sourceA)
    expect(data.getEditState().datasets[0].pendingCount).toBe(1)
    expect(data.getEditState().retained).toEqual([]); expect(data.getEditState().unsavedCount).toBe(1)
    data.replaceHistorySnapshot({ data: [row(5)] }, key, 'after')
    expect(data.getEditState().pendingCount).toBe(0); expect(data.getEditState().unsavedCount).toBe(1)
    expect(data.getEditState().retained[0].sourceIdentity).toBe(sourceA)
    const listener = vi.fn(), stop = data.subscribeEdits(listener)
    data.pruneHistory(() => false)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(data.getEditState().unsavedCount).toBe(0); expect(data.getEditState().retained).toEqual([])
    expect(data.pendingCount()).toBe(0)
    stop()
  })

  it('lists each replaced generation once when several inactive sources still have pending', () => {
    const data = new RuntimeFeatureData(), first = {}, second = {}
    data.setAll('data', [row()]); data.update('data', row(2))
    const sourceA = data.getEditState().datasets[0].sourceIdentity
    data.replaceHistorySnapshot({ data: [row(3)] }, first, 'after')
    data.update('data', row(4))
    const sourceB = data.getEditState().datasets[0].sourceIdentity
    data.replaceHistorySnapshot({ data: [row(5)] }, second, 'after')
    const state = data.getEditState()
    expect(state.pendingCount).toBe(0); expect(state.unsavedCount).toBe(2)
    expect(state.retained.map(source => source.sourceIdentity)).toEqual([sourceA, sourceB])
    expect(new Set(state.retained.map(source => source.datasetId))).toEqual(new Set(['data']))
  })

  it('counts a retained schema-only change as unsaved', () => {
    const data = new RuntimeFeatureData(), key = {}
    data.setAll('data', [row()])
    data.replaceEdited('data', [row()], { fields: [{ name: 'code', type: 'string', nullable: true }] })
    const source = data.getEditState().datasets[0].sourceIdentity
    data.replaceHistorySnapshot({ data: [row()] }, key, 'after')
    expect(data.getEditState().pendingCount).toBe(0); expect(data.getEditState().unsavedCount).toBe(1)
    expect(data.getEditState().retained[0]).toMatchObject({ sourceIdentity: source, pendingCount: 1 })
  })

  it('keeps pending on a deleted source until restore or an explicit history release', () => {
    const data = new RuntimeFeatureData()
    data.setAll('data', [row()]); data.update('data', row(2))
    const source = data.getEditState().datasets[0].sourceIdentity
    data.clear('data')
    const removed = data.getEditState()
    expect(removed.datasets).toEqual([]); expect(removed.pendingCount).toBe(0); expect(removed.unsavedCount).toBe(1)
    expect(removed.retained).toEqual([expect.objectContaining({ datasetId: 'data', sourceIdentity: source, pendingCount: 1 })])
    data.setAll('data', [row(2)])
    expect(data.getEditState().datasets[0].sourceIdentity).toBe(source)
    expect(data.getEditState().retained).toEqual([]); expect(data.getEditState().unsavedCount).toBe(1)
    data.clear('data'); data.releaseHistory()
    expect(data.getEditState().unsavedCount).toBe(0); expect(data.getEditState().retained).toEqual([])
    expect(data.getEditState().datasets).toEqual([])
  })

  it('does not publish retained cleanup while a commit session is open', async () => {
    const data = new RuntimeFeatureData(), key = {}
    data.setAll('data', [row()]); data.update('data', row(2))
    data.replaceHistorySnapshot({ data: [row(3)] }, key, 'after'); data.update('data', row(4))
    const token = data.beginCommitSession('data')
    const receipt = await data.saveDataset('data', async () => {}, undefined, token)
    const listener = vi.fn(), stop = data.subscribeEdits(listener)
    data.pruneHistory(() => false)
    expect(listener).not.toHaveBeenCalled()
    expect(data.getEditState()).toMatchObject({ pendingCount: 1, saving: true })
    data.consumeCommit(receipt!); data.endCommitSession(token)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(data.getEditState()).toMatchObject({ pendingCount: 0, saving: false, unsavedCount: 0 })
    stop()
  })

  it('blocks mutations through the history barrier and rejects a forged commit session', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row()]); data.update('data', row(2))
    const token = data.beginCommitSession('data')
    await expect(data.saveDataset('data', async () => {}, undefined, {})).rejects.toThrow('Unknown')
    const receipt = await data.saveDataset('data', async () => {}, undefined, token)
    expect(receipt).toBeDefined(); expect(data.getEditState()).toMatchObject({ pendingCount: 1, saving: true })
    expect(() => data.update('data', row(3))).toThrow('save in progress')
    data.consumeCommit(receipt!); data.endCommitSession(token)
    expect(data.getEditState()).toMatchObject({ pendingCount: 0, saving: false })
    expect(() => data.endCommitSession(token)).toThrow('Unknown')
  })

  it('isolates observer failure after publication so it cannot strand a save session', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row()]); data.update('data', row(2))
    const report = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = data.subscribeEdits(() => { throw new Error('observer') })
    try {
      const token = data.beginCommitSession('data')
      const receipt = await data.saveDataset('data', async () => {}, undefined, token)
      data.consumeCommit(receipt!); data.endCommitSession(token)
      expect(data.getEditState()).toMatchObject({ pendingCount: 0, saving: false })
      expect(report).toHaveBeenCalledTimes(2)
      stop(); data.update('data', row(3)); expect(data.pendingCount()).toBe(1)
    } finally { stop(); report.mockRestore() }
  })
})

it('publishes schema completion only after history cleanup so a completion observer can create a new undoable edit', async () => {
  projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
  layerContentCommands.addLayer('data', 'Data', [row()], 'point'); projectEdits.clear()
  const layer = requireMapContent(useProjectStore.getState().project).layers[0]
  const prepared = prepareFieldSchemaEdit(useProjectStore.getState().project, 'data', featureData.getAll('data'), { type: 'rename', from: 'value', to: 'count' })
  projectEdits.execute(new SetDatasetContentCommand('rename', 'Rename', 'data', prepared.before, prepared.after, prepared.change))
  let observed = false
  const stop = featureData.subscribeEdits(() => {
    const state = featureData.getEditState()
    if (!observed && !state.saving && state.pendingCount === 0) {
      observed = true
      featureCommands.updateProperties(layer.id, 'row', { count: 12 })
    }
  })
  try {
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(observed).toBe(true)
    expect((await featureData.readSource('data'))[0].properties).toEqual({ count: 1 })
    expect(featureData.getAll('data')[0].properties).toEqual({ count: 12 })
    expect(featureData.getEditState().pendingCount).toBe(1)
    expect(projectEdits.undo()).toBe(true); expect(projectEdits.canUndo()).toBe(false)
    expect(featureData.getAll('data')[0].properties).toEqual({ count: 1 }); expect(featureData.getEditState().pendingCount).toBe(0)
  } finally { stop() }
})

it('does not strand schema publication when a history subscriber throws', async () => {
  projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
  layerContentCommands.addLayer('data', 'Data', [row()], 'point'); projectEdits.clear()
  const prepared = prepareFieldSchemaEdit(useProjectStore.getState().project, 'data', featureData.getAll('data'), { type: 'rename', from: 'value', to: 'count' })
  projectEdits.execute(new SetDatasetContentCommand('rename', 'Rename', 'data', prepared.before, prepared.after, prepared.change))
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  const stop = projectEdits.subscribe(() => { throw new Error('history observer') })
  try {
    expect(await commitDatasetEdits('data', async () => {})).toBe(true)
    expect(featureData.getEditState()).toMatchObject({ pendingCount: 0, saving: false })
    expect(projectEdits.canUndo()).toBe(false); expect(projectEdits.getBlockReason('undo')).toBeNull()
    expect(report).toHaveBeenCalled()
  } finally { stop(); report.mockRestore() }
})

it('preflights data undo while a row save waits and leaves configuration undo available after cleanup', async () => {
  projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
  layerContentCommands.addLayer('data', 'Data', [row()], 'point'); projectEdits.clear()
  const layer = requireMapContent(useProjectStore.getState().project).layers[0]
  const { layerConfigurationCommands } = await import('@/commands/layer-configuration.commands')
  layerConfigurationCommands.renameLayer(layer.id, 'Configured')
  featureCommands.updateProperties(layer.id, 'row', { value: 9 })
  let finish!: () => void
  const saving = commitDatasetEdits('data', () => new Promise<void>(resolve => { finish = resolve }))
  expect(projectEdits.getBlockReason('undo')).toContain('数据保存进行中')
  expect(projectEdits.undo()).toBe(false)
  finish(); expect(await saving).toBe(true)
  expect(projectEdits.getBlockReason('undo')).toBeNull()
  expect(projectEdits.undo()).toBe(true)
  expect(requireMapContent(useProjectStore.getState().project).layers[0].name).toBe('Data')
  expect(featureData.getAll('data')[0].properties.value).toBe(9)
})
