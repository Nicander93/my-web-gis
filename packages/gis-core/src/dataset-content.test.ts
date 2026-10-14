import { expect, it, vi } from 'vitest'
import { SetDatasetContentCommand, type ProjectEditContext } from './configCommands'
import { MemoryFeatureStore } from './featureStore'
import { createProject, createDefaultLayerStyle } from './project'
import type { GisFeature } from './types'

it('rejects a re-bound layer before writing any dataset rows or configuration', () => {
  const project = createProject('Rebind')
  project.datasets = [{ id: 'original', name: 'Original', kind: 'vector', source: { type: 'memory', label: 'Original' } }]
  project.layers = [{ id: 'layer', datasetId: 'another', name: 'Another', visible: true, opacity: 1,
    editable: true, style: createDefaultLayerStyle('point') }]
  const feature: GisFeature = { id: 'row', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 2 } }
  const featureStore = new MemoryFeatureStore()
  featureStore.setAll('original', [feature])
  const replaceProject = vi.fn()
  const context: ProjectEditContext = { featureStore, getProject: () => project, replaceProject }
  const content = { features: [feature], layers: [{ id: 'layer', style: project.layers[0].style }] }
  const command = new SetDatasetContentCommand('schema', '字段编辑', 'original', content,
    { ...content, features: [{ ...feature, properties: { population: 2 } }] })
  expect(() => command.execute(context)).toThrow(/绑定其他数据集/)
  expect(featureStore.getAll('original')).toEqual([feature])
  expect(replaceProject).not.toHaveBeenCalled()
})
