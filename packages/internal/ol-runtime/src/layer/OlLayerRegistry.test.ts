import { describe, expect, it } from 'vitest'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { OlLayerRegistry } from './OlLayerRegistry'

describe('OlLayerRegistry', () => {
  it('retains both display nodes for a shared dataset when one is removed or rebound', () => {
    const registry = new OlLayerRegistry(), first = new VectorLayer({ source: new VectorSource() }), second = new VectorLayer({ source: new VectorSource() })
    registry.register('first', 'shared', first); registry.register('second', 'shared', second)
    expect(registry.getDatasetIdForLayer('first')).toBe('shared')
    expect(registry.getDatasetIdForLayer('second')).toBe('shared')
    expect(registry.getAllByDataset('shared')).toEqual([first, second])
    expect(registry.getByDataset('shared')).toBe(second)
    registry.unregister('second')
    expect(registry.getByDataset('shared')).toBe(first)
    registry.register('second', 'shared', second)
    registry.register('first', 'other', first)
    expect(registry.getAllByDataset('shared')).toEqual([second])
    expect(registry.getDatasetIdForLayer('first')).toBe('other')
    registry.clear()
    expect(registry.getAllByDataset('shared')).toEqual([])
    expect(registry.getDatasetIdForLayer('first')).toBeUndefined()
  })
  it('maps domain layer ids and dataset ids to runtime layers', () => {
    const registry = new OlLayerRegistry()
    const layer = new VectorLayer({ source: new VectorSource() })

    registry.register('layer-rivers', 'dataset-rivers', layer)

    expect(registry.get('layer-rivers')).toBe(layer)
    expect(registry.getByDataset('dataset-rivers')).toBe(layer)
    expect(registry.getDatasetIdForLayer('layer-rivers')).toBe('dataset-rivers')

    registry.unregister('layer-rivers')

    expect(registry.get('layer-rivers')).toBeUndefined()
    expect(registry.getByDataset('dataset-rivers')).toBeUndefined()
  })
})
