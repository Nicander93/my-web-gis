import { describe, expect, it } from 'vitest'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import { OlLayerRegistry } from './OlLayerRegistry'

describe('OlLayerRegistry', () => {
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
