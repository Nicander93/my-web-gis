import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyFieldFilter,
  computeFieldStats,
  createProject,
  sortFeatures,
  type GisFeature
} from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'

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
    useProjectStore.getState()._resetAttributeHistoryForTests()
    useSessionStore.setState({ sessions: {} })
    useProjectStore.setState({
      project: createProject('P12 test'),
      featuresByDataset: {},
      dirty: false,
      selectedLayerId: null,
      selection: { layerId: null, featureIds: [] },
      lastSelectionCountAfterFilter: null
    })
  })

  it('map and table share F; filter converges S to S ∩ F', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setSelection({ layerId, featureIds: ['f-a', 'f-b', 'f-d'] })
    expect(useProjectStore.getState().selection.featureIds).toEqual(['f-a', 'f-b', 'f-d'])

    useProjectStore.getState().setLayerFilter(layerId, [{ field: 'pop', op: 'gte', value: 20 }])
    const filtered = useProjectStore.getState().getFilteredFeatures(layerId)
    expect(filtered.map((f) => f.id)).toEqual(['f-b', 'f-c'])
    expect(useProjectStore.getState().selection.featureIds).toEqual(['f-b'])
    expect(useProjectStore.getState().lastSelectionCountAfterFilter).toBe(1)

    // same helper the map runtime uses
    const layer = useProjectStore.getState().project.layers.find((l) => l.id === layerId)!
    expect(applyFieldFilter(sample, layer.filter).map((f) => f.id)).toEqual(['f-b', 'f-c'])
  })

  it('selectMatching is explicit; filter does not auto-select', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setLayerFilter(layerId, [{ field: 'name', op: 'contains', value: 'lph' }])
    expect(useProjectStore.getState().selection.featureIds).toEqual([])
    useProjectStore.getState().selectMatching(layerId)
    expect(useProjectStore.getState().selection.featureIds).toEqual(['f-a'])
  })

  it('selection is stable across sort/page by Feature ID (not row index)', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setSelection({ layerId, featureIds: ['f-c'] })

    const sorted = sortFeatures(useProjectStore.getState().getFilteredFeatures(layerId), [
      { field: 'pop', direction: 'desc' }
    ])
    // nulls first on desc, then 30, 20, 10
    expect(sorted.map((f) => f.id)).toEqual(['f-d', 'f-b', 'f-c', 'f-a'])
    const page = sorted.slice(0, 2)
    expect(page.map((f) => f.id)).toEqual(['f-d', 'f-b'])
    // selection still keyed by Feature ID after sort/page
    expect(useProjectStore.getState().selection.featureIds).toEqual(['f-c'])
  })

  it('selectedOnly empty shows empty affordance state (session flag)', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    useSessionStore.getState().setAttributeTableState(layerId, { selectedOnly: true })
    expect(useSessionStore.getState().getLayerSession(layerId).attributeTable?.selectedOnly).toBe(true)
    expect(useProjectStore.getState().selection.featureIds).toEqual([])
    // F unchanged
    expect(useProjectStore.getState().getFilteredFeatures(layerId)).toHaveLength(4)
  })

  it('table search is session-only and does not change F or S', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setSelection({ layerId, featureIds: ['f-a'] })
    useSessionStore.getState().setAttributeTableState(layerId, { searchQuery: 'Beta' })
    expect(useProjectStore.getState().getFilteredFeatures(layerId)).toHaveLength(4)
    expect(useProjectStore.getState().selection.featureIds).toEqual(['f-a'])
    expect(useSessionStore.getState().getLayerSession(layerId).attributeTable?.searchQuery).toBe('Beta')
  })

  it('attribute edit recomputes F/stats; undo restores properties', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setLayerFilter(layerId, [{ field: 'pop', op: 'gte', value: 25 }])
    expect(useProjectStore.getState().getFilteredFeatures(layerId).map((f) => f.id)).toEqual(['f-b'])

    useProjectStore.getState().updateFeatureProperties(layerId, 'f-a', { name: 'Alpha', pop: 40 })
    expect(useProjectStore.getState().getFilteredFeatures(layerId).map((f) => f.id).sort()).toEqual([
      'f-a',
      'f-b'
    ])

    const stats = computeFieldStats(
      useProjectStore.getState().getFilteredFeatures(layerId),
      'pop',
      'filtered'
    )
    expect(stats.numeric?.min).toBe(30)
    expect(Number.isNaN(stats.numeric?.mean ?? NaN)).toBe(false)

    expect(useProjectStore.getState().undoAttributeEdit()).toBe(true)
    expect(
      useProjectStore.getState().featuresByDataset['ds-1'].find((f) => f.id === 'f-a')?.properties.pop
    ).toBe(10)
    expect(useProjectStore.getState().getFilteredFeatures(layerId).map((f) => f.id)).toEqual(['f-b'])
  })

  it('empty stats do not yield NaN', () => {
    const stats = computeFieldStats([], 'pop', 'all')
    expect(stats.numeric).toBeNull()
    expect(stats.total).toBe(0)
  })

  it('boundary: is-empty and failed numeric compare', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setLayerFilter(layerId, [{ field: 'pop', op: 'is-empty' }])
    expect(useProjectStore.getState().getFilteredFeatures(layerId).map((f) => f.id)).toEqual(['f-d'])
    useProjectStore.getState().setLayerFilter(layerId, [{ field: 'name', op: 'gt', value: 1 }])
    expect(useProjectStore.getState().getFilteredFeatures(layerId)).toHaveLength(0)
  })
})
