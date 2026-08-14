import { describe, expect, it } from 'vitest'
import { AddFeatureCommand, EditHistory, MemoryFeatureStore, UpdatePropertiesCommand } from './index'

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
})
