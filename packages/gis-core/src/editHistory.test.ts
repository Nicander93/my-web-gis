import { describe, expect, it } from 'vitest'
import { AddFeatureCommand, EditHistory, MemoryFeatureStore, UpdatePropertiesCommand, type EditCommand } from './index'

describe('EditHistory', () => {
  it('executes, undoes, and redoes feature edits', () => {
    const featureStore = new MemoryFeatureStore()
    const context = { featureStore }
    const history = new EditHistory()
    const feature = {
      id: 'f-1',
      geometry: { type: 'Point' as const, coordinates: [1, 2] as [number, number] },
      properties: { name: 'Station A' }
    }

    history.execute(new AddFeatureCommand('cmd-1', 'dataset-1', feature), context)
    expect(featureStore.getAll('dataset-1')).toHaveLength(1)

    history.execute(
      new UpdatePropertiesCommand('cmd-2', 'dataset-1', 'f-1', { name: 'Station A' }, { name: 'Station B' }),
      context
    )
    expect(featureStore.getById('dataset-1', 'f-1')?.properties.name).toBe('Station B')

    history.undo(context)
    expect(featureStore.getById('dataset-1', 'f-1')?.properties.name).toBe('Station A')

    history.undo(context)
    expect(featureStore.getAll('dataset-1')).toHaveLength(0)

    history.redo(context)
    expect(featureStore.getAll('dataset-1')).toHaveLength(1)
  })
  it('keeps the same command available after a failed undo or redo so the host can retry', () => {
    const history = new EditHistory(), context = { featureStore: new MemoryFeatureStore() }
    let failUndo = true, failExecute = false, value = 0
    const command: EditCommand = {
      id: 'scene', label: 'Replace scene',
      execute: () => { if (failExecute) throw new Error('prepare failed'); value = 1 },
      undo: () => { if (failUndo) throw new Error('restore failed'); value = 0 }
    }
    history.execute(command, context)
    expect(history.peekUndo()).toBe(command)
    expect(() => history.undo(context)).toThrow('restore failed')
    expect(history.undoCount).toBe(1)
    expect(history.redoCount).toBe(0)
    expect(value).toBe(1)
    failUndo = false
    expect(history.undo(context)).toBe(command)
    expect(history.peekRedo()).toBe(command)
    failExecute = true
    expect(() => history.redo(context)).toThrow('prepare failed')
    expect(history.undoCount).toBe(0)
    expect(history.redoCount).toBe(1)
    expect(value).toBe(0)
    failExecute = false
    expect(history.redo(context)).toBe(command)
    expect(value).toBe(1)
  })
})
