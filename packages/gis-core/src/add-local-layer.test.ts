import { describe, expect, it } from 'vitest'
import { AddLocalLayerCommand, type ProjectEditContext } from './configCommands'
import { MemoryFeatureStore } from './featureStore'
import { createProject, createDefaultLayerStyle } from './project'
import type { Dataset, GisFeature, Layer } from './types'

describe('independent result layer command', () => {
  it('restores stable ids and independent features through undo and redo', () => {
    let project = createProject('command test')
    const original = structuredClone(project)
    const featureStore = new MemoryFeatureStore()
    const context: ProjectEditContext = { featureStore, getProject: () => project, replaceProject: value => { project = value } }
    const dataset: Extract<Dataset, { kind: 'vector' }> = { id: 'result', name: 'Result', kind: 'vector', source: { type: 'memory', label: 'Result' } }
    const layer: Layer = { id: 'layer', datasetId: dataset.id, name: 'Result', visible: true, opacity: 1, editable: false, style: createDefaultLayerStyle('point'), filter: [] }
    const features: GisFeature[] = [{ id: 'f', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { value: 1 } }]
    const command = new AddLocalLayerCommand('cmd', dataset, layer, features)
    features[0].properties.value = 99
    command.execute(context)
    expect(featureStore.getAll('result')[0].properties.value).toBe(1)
    expect(() => command.execute(context)).toThrow('已存在')
    command.undo(context)
    expect(project).toEqual(original)
    expect(featureStore.snapshot()).toEqual({})
    command.execute(context)
    expect(project.layers[0].id).toBe('layer')
    expect(featureStore.getAll('result')[0].id).toBe('f')
  })
})
