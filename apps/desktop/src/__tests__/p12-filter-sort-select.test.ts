import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { layerContentCommands } from '@/commands/layer-content.commands'
import { featureCommands } from '@/commands/feature.commands'
import { getFilteredFeatures } from '@/project/feature-query'
import { projectEdits } from '@/project/project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { selectionCommands } from '@/commands/selection.commands'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyFieldFilter,
  computeFieldStats,
  createProject,
  sortFeatures,
  type GisFeature
} from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'

function feat(id: string, properties: Record<string, unknown>): GisFeature {
  return {
    id,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties
  }
}

const sample = [
  feat('f-a', { name: 'Alpha', pop: 10 }),
  feat('f-b', { name: 'Beta', pop: 30 }),
  feat('f-c', { name: 'Charlie', pop: 20 }),
  feat('f-d', { name: 'Delta', pop: null })
]

describe('P12 set semantics / filter / selection', () => {
  beforeEach(() => {
    projectEdits.clear()
    useLayerViewStore.setState({ sessions: {} })
    useProjectStore.setState({ project: createProject('P12 test'), dirty: false }); featureData.replaceAll({}); useLayerViewStore.setState({ selectedLayerId: null, selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: null })
  })

  it('map and table share F; filter converges S to S ∩ F', () => {
    layerContentCommands.addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useLayerViewStore.getState().selectedLayerId!
    selectionCommands.setSelection({ layerId, featureIds: ['f-a', 'f-b', 'f-d'] })
    expect(useLayerViewStore.getState().selection.featureIds).toEqual(['f-a', 'f-b', 'f-d'])

    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'pop', op: 'gte', value: 20 }])
    const filtered = getFilteredFeatures(layerId)
    expect(filtered.map((f) => f.id)).toEqual(['f-b', 'f-c'])
    expect(useLayerViewStore.getState().selection.featureIds).toEqual(['f-b'])
    expect(useLayerViewStore.getState().lastSelectionCountAfterFilter).toBe(1)

    // 和地图运行时用的是同一个辅助函数。
    const layer = requireMapContent(useProjectStore.getState().project).layers.find((l) => l.id === layerId)!
    expect(applyFieldFilter(sample, layer.filter).map((f) => f.id)).toEqual(['f-b', 'f-c'])
  })

  it('selectMatching is explicit; filter does not auto-select', () => {
    layerContentCommands.addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useLayerViewStore.getState().selectedLayerId!
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'name', op: 'contains', value: 'lph' }])
    expect(useLayerViewStore.getState().selection.featureIds).toEqual([])
    selectionCommands.selectMatching(layerId)
    expect(useLayerViewStore.getState().selection.featureIds).toEqual(['f-a'])
  })

  it('selection is stable across sort/page by Feature ID (not row index)', () => {
    layerContentCommands.addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useLayerViewStore.getState().selectedLayerId!
    selectionCommands.setSelection({ layerId, featureIds: ['f-c'] })

    const sorted = sortFeatures(getFilteredFeatures(layerId), [
      { field: 'pop', direction: 'desc' }
    ])
    // 降序时空值排在最前，然后是 30、20、10。
    expect(sorted.map((f) => f.id)).toEqual(['f-d', 'f-b', 'f-c', 'f-a'])
    const page = sorted.slice(0, 2)
    expect(page.map((f) => f.id)).toEqual(['f-d', 'f-b'])
    // 排序或翻页之后，选择仍然以要素 ID 为键。
    expect(useLayerViewStore.getState().selection.featureIds).toEqual(['f-c'])
  })

  it('selectedOnly empty shows empty affordance state (session flag)', () => {
    layerContentCommands.addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useLayerViewStore.getState().selectedLayerId!
    useLayerViewStore.getState().setAttributeTableState(layerId, { selectedOnly: true })
    expect(useLayerViewStore.getState().getLayerSession(layerId).attributeTable?.selectedOnly).toBe(true)
    expect(useLayerViewStore.getState().selection.featureIds).toEqual([])
    // F 保持不变。
    expect(getFilteredFeatures(layerId)).toHaveLength(4)
  })

  it('table search is session-only and does not change F or S', () => {
    layerContentCommands.addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useLayerViewStore.getState().selectedLayerId!
    selectionCommands.setSelection({ layerId, featureIds: ['f-a'] })
    useLayerViewStore.getState().setAttributeTableState(layerId, { searchQuery: 'Beta' })
    expect(getFilteredFeatures(layerId)).toHaveLength(4)
    expect(useLayerViewStore.getState().selection.featureIds).toEqual(['f-a'])
    expect(useLayerViewStore.getState().getLayerSession(layerId).attributeTable?.searchQuery).toBe('Beta')
  })

  it('attribute edit recomputes F/stats; undo restores properties', () => {
    layerContentCommands.addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useLayerViewStore.getState().selectedLayerId!
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'pop', op: 'gte', value: 25 }])
    expect(getFilteredFeatures(layerId).map((f) => f.id)).toEqual(['f-b'])

    featureCommands.updateProperties(layerId, 'f-a', { name: 'Alpha', pop: 40 })
    expect(getFilteredFeatures(layerId).map((f) => f.id).sort()).toEqual([
      'f-a',
      'f-b'
    ])

    const stats = computeFieldStats(
      getFilteredFeatures(layerId),
      'pop',
      'filtered'
    )
    expect(stats.numeric?.min).toBe(30)
    expect(Number.isNaN(stats.numeric?.mean ?? NaN)).toBe(false)

    expect(projectEdits.undo()).toBe(true)
    expect(
      featureData.readSnapshot()['ds-1'].find((f) => f.id === 'f-a')?.properties.pop
    ).toBe(10)
    expect(getFilteredFeatures(layerId).map((f) => f.id)).toEqual(['f-b'])
  })

  it('empty stats do not yield NaN', () => {
    const stats = computeFieldStats([], 'pop', 'all')
    expect(stats.numeric).toBeNull()
    expect(stats.total).toBe(0)
  })

  it('boundary: is-empty and failed numeric compare', () => {
    layerContentCommands.addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useLayerViewStore.getState().selectedLayerId!
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'pop', op: 'is-empty' }])
    expect(getFilteredFeatures(layerId).map((f) => f.id)).toEqual(['f-d'])
    layerConfigurationCommands.setLayerFilter(layerId, [{ field: 'name', op: 'gt', value: 1 }])
    expect(getFilteredFeatures(layerId)).toHaveLength(0)
  })
})
