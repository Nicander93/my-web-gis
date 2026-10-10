import { describe, expect, it } from 'vitest'
import { ApplyProjectSnapshotEditCommand, ReplaceProjectSnapshotCommand, type ProjectEditContext } from './configCommands'
import { createProject } from './project'
import { MemoryFeatureStore } from './featureStore'
import { EditHistory } from './editHistory'
import type { ProjectSnapshot } from './types'

function snapshot(id: string): ProjectSnapshot {
  const project = createProject(id)
  project.datasets.push({ id, name: id, kind: 'vector', source: { type: 'memory', label: id } })
  return { project, featuresByDataset: { [id]: [{ id: 'one', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { source: id } }] } }
}
describe('full content replacement history', () => {
  it('rejects a delta edit without an atomic host path before touching features', () => {
    const before = snapshot('data'), after = structuredClone(before), store = new MemoryFeatureStore()
    store.setAll('data', before.featuresByDataset.data)
    after.featuresByDataset.data[0].properties.source = 'New'
    const context: ProjectEditContext = { featureStore: store, getProject: () => before.project, replaceProject: () => {} }
    expect(() => new ApplyProjectSnapshotEditCommand('edit', 'Edit', before, after).execute(context)).toThrow('原子')
    expect(store.snapshot()).toEqual(before.featuresByDataset)
  })
  it('patches changed properties while retaining unrelated later feature and project fields on undo', () => {
    const before = snapshot('data'), after = structuredClone(before), store = new MemoryFeatureStore()
    after.featuresByDataset.data[0].properties.source = 'Edited'
    after.project.name = 'Edited name'
    let content = structuredClone(before)
    store.setAll('data', content.featuresByDataset.data)
    const context: ProjectEditContext = { featureStore: store, getProject: () => content.project, replaceProject: () => {},
      applySnapshotEdit: next => { content = next } }
    const command = new ApplyProjectSnapshotEditCommand('edit', 'Edit', before, after)
    command.execute(context)
    const refreshed = store.getAll('data'); refreshed[0].properties.extra = 7
    refreshed.push({ id: 'later', geometry: { type: 'Point', coordinates: [2, 3] }, properties: {} })
    store.setAll('data', refreshed); content.project.settings.external = true
    command.undo(context)
    expect(content.project.name).toBe(before.project.name)
    expect(content.project.settings.external).toBe(true)
    expect(store.getAll('data')).toMatchObject([{ id: 'one', properties: { source: 'data', extra: 7 } }, { id: 'later' }])
  })
  it('replaces all feature datasets and restores them with one undo and redo', () => {
    const before = snapshot('old'), after = snapshot('new'), store = new MemoryFeatureStore()
    store.setAll('old', before.featuresByDataset.old)
    let project = before.project
    const context: ProjectEditContext = { featureStore: store, getProject: () => project, replaceProject: next => { project = next } }
    const history = new EditHistory(), command = new ReplaceProjectSnapshotCommand('replace', 'Import scene', before, after)
    after.featuresByDataset.new[0].properties.source = 'Changed outside'
    history.execute(command, context)
    expect(project.datasets.map(dataset => dataset.id)).toEqual(['new'])
    expect(store.snapshot()).toEqual({ new: [{ ...before.featuresByDataset.old[0], properties: { source: 'new' } }] })
    history.undo(context)
    expect(project).toEqual(before.project)
    expect(store.snapshot()).toEqual(before.featuresByDataset)
    expect(history.canUndo).toBe(false)
    history.redo(context)
    expect(store.getAll('new')[0].properties.source).toBe('new')
  })
})
