import { describe, expect, it, vi } from 'vitest'
import { MemoryFeatureProvider } from '@desktop-webgis/project'
import { RuntimeFeatureData } from './feature-data-runtime'
import { featureData } from './feature-data'
import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { featureCommands } from '@/commands/feature.commands'
import { createProject, requireMapContent, type GisFeature } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
const row = (id: string, value = 1): GisFeature => ({ id, geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value } })

describe('actual runtime Provider and Buffer ownership', () => {
  it('validates a new schema before clearing the current project, selection, buffer or history', () => {
    projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
    layerContentCommands.addLayer('data', 'Data', [row('a')], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id
    featureCommands.updateProperties(id, 'a', { value: 9 })
    const project = useProjectStore.getState(), session = useLayerViewStore.getState(), workbench = useWorkbenchStore.getState()
    const history = projectEdits.getState(), rows = featureData.readSnapshot()
    const invalid = projectSession.getSnapshot(), field = { name: 'value', type: 'number' as const, nullable: true }
    requireMapContent(invalid.project).datasets[0].fields = [field, field]
    expect(() => projectSession.loadSnapshot(invalid)).toThrow('Invalid dataset schema')
    expect(useProjectStore.getState()).toBe(project); expect(useLayerViewStore.getState()).toBe(session)
    expect(useWorkbenchStore.getState()).toBe(workbench); expect(projectEdits.getState()).toBe(history)
    expect(featureData.readSnapshot()).toBe(rows); expect(featureData.pendingCount()).toBe(1)
  })

  it('restores the current committed source instead of stale creation rows', async () => {
    projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
    layerContentCommands.addLayer('data', 'Data', [row('a')], 'point')
    // 模拟数据提交屏障之后剩余的那部分配置历史。
    featureData.update('data', row('a', 9)); await featureData.saveDataset('data', async () => {})
    expect(projectEdits.undo()).toBe(true); expect(featureData.getDatasetIds()).not.toContain('data')
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.getById('data', 'a')).toEqual(row('a', 9))
    expect(await featureData.readSource('data')).toEqual([row('a', 9)]); expect(featureData.pendingCount()).toBe(0)
  })
  it('restores a saved replacement source even when the old command snapshot contains pre-save rows', async () => {
    const data = new RuntimeFeatureData(), key = {}
    data.setAll('data', [row('a')]); data.update('data', row('a', 9))
    data.replaceHistorySnapshot({ data: [row('b', 20)] }, key, 'after')
    data.update('data', row('b', 30)); await data.saveDataset('data', async () => {})
    data.replaceHistorySnapshot({ data: [row('a', 9)] }, key, 'before')
    expect(data.getAll('data')).toEqual([row('a', 9)]); expect(data.pendingCount()).toBe(1)
    data.replaceHistorySnapshot({ data: [row('b', 20)] }, key, 'after')
    expect(data.getAll('data')).toEqual([row('b', 30)])
    expect(await data.readSource('data')).toEqual([row('b', 30)]); expect(data.pendingCount()).toBe(0)
  })

  it('disposes a replacement source after its redo branch is discarded while retaining the active source', async () => {
    const data = new RuntimeFeatureData(), key = {}
    data.setAll('data', [row('a')]); data.update('data', row('a', 9))
    data.replaceHistorySnapshot({ data: [row('b')] }, key, 'after')
    data.replaceHistorySnapshot({ data: [row('a', 9)] }, key, 'before')
    const dispose = vi.spyOn(MemoryFeatureProvider.prototype, 'dispose')
    try {
      data.pruneHistory(() => false)
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(await data.readSource('data')).toEqual([row('a')]); expect(data.pendingCount()).toBe(1)
      data.releaseHistory(); expect(dispose).toHaveBeenCalledTimes(1)
    } finally { dispose.mockRestore() }
  })

  it('restores source and pending boundaries when project replacement is undone and redone', async () => {
    projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
    layerContentCommands.addLayer('data', 'Data', [row('a')], 'point')
    const layerId = requireMapContent(useProjectStore.getState().project).layers[0].id
    projectEdits.clear(); featureCommands.updateProperties(layerId, 'a', { value: 9 })
    const replacement = projectSession.getSnapshot()
    replacement.project.metadata.id = 'replacement'; replacement.featuresByDataset.data = [row('a', 20)]
    projectSession.replaceSnapshotAsEdit(replacement, 'Replace')
    expect(featureData.pendingCount()).toBe(0); expect(featureData.getEditState().unsavedCount).toBe(1)
    expect(await featureData.readSource('data')).toEqual([row('a', 20)])
    featureCommands.updateProperties(layerId, 'a', { value: 30 })
    expect(featureData.pendingCount()).toBe(1); expect(featureData.getEditState().unsavedCount).toBe(2)
    expect(projectEdits.undo()).toBe(true); expect(featureData.pendingCount()).toBe(0)
    expect(featureData.getEditState().unsavedCount).toBe(1)
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.pendingCount()).toBe(1); expect(featureData.getById('data', 'a')).toEqual(row('a', 9))
    expect(featureData.getEditState().retained).toEqual([]); expect(featureData.getEditState().unsavedCount).toBe(1)
    expect(await featureData.readSource('data')).toEqual([row('a')])
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.pendingCount()).toBe(0); expect(featureData.getEditState().unsavedCount).toBe(1)
    expect(await featureData.readSource('data')).toEqual([row('a', 20)])
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.pendingCount()).toBe(1); expect(featureData.getEditState().unsavedCount).toBe(2)
    expect(featureData.getById('data', 'a')).toEqual(row('a', 30))
    projectEdits.clear()
    expect(featureData.getEditState().retained).toEqual([])
    expect(featureData.getEditState().unsavedCount).toBe(featureData.pendingCount())
    expect(await featureData.readSource('data')).toEqual([row('a', 20)])
  })
  it('rolls replacement resource frames back after failure and permits retry', async () => {
    const data = new RuntimeFeatureData(), key = {}
    data.setAll('data', [row('a')]); data.update('data', row('a', 9))
    const before = data.readSnapshot()
    expect(() => data.transaction(() => { data.replaceHistorySnapshot({ data: [row('b')] }, key, 'after'); throw new Error('fail') })).toThrow('fail')
    expect(data.readSnapshot()).toBe(before); expect(data.pendingCount()).toBe(1)
    expect(await data.readSource('data')).toEqual([row('a')])
    data.replaceHistorySnapshot({ data: [row('b')] }, key, 'after')
    data.replaceHistorySnapshot({ data: [row('a', 9)] }, key, 'before')
    expect(data.pendingCount()).toBe(1); expect(await data.readSource('data')).toEqual([row('a')])
    data.releaseHistory(); expect(await data.readSource('data')).toEqual([row('a')])
  })

  it('rejects a source refresh that would silently discard pending edits', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row('a')]); data.update('data', row('a', 9))
    const view = data.readSnapshot(), revision = data.revision
    expect(() => data.setAll('data', [row('other')])).toThrow('pending edits')
    expect(data.pendingCount()).toBe(1); expect(data.readSnapshot()).toBe(view); expect(data.revision).toBe(revision)
    expect(await data.readSource('data')).toEqual([row('a')])
  })

  it('routes existing Application edits and Undo/Redo to an overlay while retaining the source', async () => {
    projectSession.loadSnapshot({ project: createProject(), featuresByDataset: {} })
    layerContentCommands.addLayer('data', 'Data', [row('a')], 'point')
    const id = requireMapContent(useProjectStore.getState().project).layers[0].id
    projectEdits.clear()
    expect(featureData.pendingCount()).toBe(0)
    expect(featureCommands.updateProperties(id, 'a', { value: 9 })).toBe(true)
    expect(featureData.getById('data', 'a')).toEqual(row('a', 9)); expect(featureData.pendingCount()).toBe(1)
    expect(await featureData.readSource('data')).toEqual([row('a')])
    expect(projectEdits.undo()).toBe(true); expect(featureData.pendingCount()).toBe(0)
    expect(projectEdits.redo()).toBe(true); expect(featureData.pendingCount()).toBe(1)
    layerContentCommands.removeLayer(id)
    expect(featureData.pendingCount()).toBe(0)
    expect(featureData.getEditState().datasets).toEqual([]); expect(featureData.getEditState().unsavedCount).toBe(1)
    expect(projectEdits.undo()).toBe(true)
    expect(featureData.pendingCount()).toBe(1); expect(featureData.getEditState().retained).toEqual([])
    expect(featureData.getById('data', 'a')).toEqual(row('a', 9))
    expect(await featureData.readSource('data')).toEqual([row('a')])
  })
  it('rolls cache, overlay and owner initialization back as one transaction', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row('a')])
    const view = data.readSnapshot(), revision = data.revision
    expect(() => data.transaction(() => { data.update('data', row('a', 9)); data.setAll('new', [row('b')]); throw new Error('fail') })).toThrow('fail')
    expect(data.readSnapshot()).toBe(view); expect(data.revision).toBe(revision)
    expect(data.pendingCount()).toBe(0); expect(await data.readSource('data')).toEqual([row('a')]); expect(await data.readSource('new')).toEqual([])
  })
  it('reconciles full user replacements as deltas and preserves them across same-project snapshots', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row('a'), row('b')])
    data.replaceEdited('data', [row('a', 9), row('c')])
    expect(data.pendingCount()).toBe(3)
    expect(await data.readSource('data')).toEqual([row('a'), row('b')])
    data.replaceEffectiveSnapshot({ data: [row('a'), row('b')] })
    expect(data.pendingCount()).toBe(0); expect(data.getAll('data')).toEqual([row('a'), row('b')])
  })
  it('starts new source ownership for a new epoch even with reused dataset IDs and restores failed loads', async () => {
    const data = new RuntimeFeatureData(); data.setAll('data', [row('a')]); data.update('data', row('a', 9))
    expect(() => data.transaction(() => { data.replaceAll({ data: [row('other')] }); throw new Error('fail') })).toThrow('fail')
    expect(data.pendingCount()).toBe(1); expect(await data.readSource('data')).toEqual([row('a')])
    data.replaceAll({ data: [row('other')] })
    expect(data.pendingCount()).toBe(0); expect(await data.readSource('data')).toEqual([row('other')])
  })

  it('captures and reinstalls the Provider baseline with pending overlay for recovery', async () => {
    const data = new RuntimeFeatureData()
    data.setAll('data', [row('a')], { fields: [{ name: 'value', type: 'number', nullable: true }] })
    data.update('data', row('a', 9)); data.add('data', row('b', 2))
    const sessions = data.captureActiveSessions()
    expect(sessions.data.source).toEqual([row('a')])
    expect(sessions.data.pending?.updates).toEqual([row('a', 9)])
    expect(sessions.data.pending?.inserts).toEqual([row('b', 2)])
    const restored = new RuntimeFeatureData()
    restored.installActiveSessions(sessions)
    expect(await restored.readSource('data')).toEqual([row('a')])
    expect(restored.getAll('data')).toEqual([row('a', 9), row('b', 2)])
    expect(restored.pendingCount()).toBe(2)
    expect(restored.getEditState().unsavedCount).toBe(2)
  })

  it('discards the overlay and restores the effective cache from the Provider baseline', async () => {
    const data = new RuntimeFeatureData()
    data.setAll('data', [row('a')], { fields: [{ name: 'value', type: 'number', nullable: true }] })
    data.update('data', row('a', 9))
    data.replaceEdited('data', [row('a', 9)], { fields: [{ name: 'value', type: 'number', nullable: true }, { name: 'code', type: 'string', nullable: true }] })
    expect(data.pendingCount()).toBeGreaterThan(0)
    data.discardDataset('data')
    expect(data.pendingCount()).toBe(0)
    expect(data.getAll('data')).toEqual([row('a')])
    expect(await data.readSource('data')).toEqual([row('a')])
    expect(data.getEffectiveFields('data')).toEqual([{ name: 'value', type: 'number', nullable: true }])
    expect(data.getEditState().unsavedCount).toBe(0)
  })
})
