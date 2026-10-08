import { describe, expect, it } from 'vitest'
import { ReplaceProjectSnapshotCommand, type ProjectEditContext } from './configCommands'
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
