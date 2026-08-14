import { describe, expect, it } from 'vitest'
import {
  MemoryFeatureStore,
  createDefaultLayerStyle,
  createProject,
  parseProjectSnapshot,
  serializeProjectSnapshot
} from './index'

describe('project snapshots', () => {
  it('serializes project metadata together with edited feature data', () => {
    const project = createProject('Rivers')
    const datasetId = 'dataset-rivers'
    project.datasets.push({
      id: datasetId,
      name: 'rivers',
      kind: 'vector',
      source: { type: 'geojson-file', path: './examples/rivers.geojson' }
    })
    project.layers.push({
      id: 'layer-rivers',
      datasetId,
      name: 'Rivers',
      visible: true,
      opacity: 0.75,
      editable: true,
      style: createDefaultLayerStyle('line')
    })

    const featureStore = new MemoryFeatureStore()
    featureStore.setAll(datasetId, [
      {
        id: 'river-1',
        geometry: {
          type: 'LineString',
          coordinates: [
            [106.62, 26.54],
            [106.66, 26.57]
          ]
        },
        properties: { name: 'North Fork', level: 1 }
      }
    ])

    const text = serializeProjectSnapshot({
      project,
      featuresByDataset: featureStore.snapshot()
    })
    const restored = parseProjectSnapshot(text)

    expect(restored.project.name).toBe('Rivers')
    expect(restored.project.layers[0]?.opacity).toBe(0.75)
    expect(restored.featuresByDataset[datasetId]?.[0]?.properties.name).toBe('North Fork')
  })
})
