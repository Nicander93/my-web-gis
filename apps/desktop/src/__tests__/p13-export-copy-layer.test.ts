import { beforeEach, describe, expect, it } from 'vitest'
import {
  createProject,
  parseGeoJsonFeatures,
  stringifyGeoJson,
  type GisFeature
} from '@desktop-webgis/gis-core'
import { featuresToCsv } from '@desktop-webgis/vector-io'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import {
  countExportScopes,
  resolveExportFeatures,
  type TableViewState
} from '@/features/export/exportScopes'

function feat(
  id: string,
  properties: Record<string, unknown>,
  coords: [number, number] = [0, 0]
): GisFeature {
  return {
    id,
    geometry: { type: 'Point', coordinates: coords },
    properties
  }
}

const sample = [
  feat('f-a', { name: 'Alpha', note: '=1+2', pop: 10 }, [116.4, 39.9]),
  feat('f-b', { name: 'Beta', note: 'safe', pop: 30 }, [121.5, 31.2]),
  feat('f-c', { name: 'Charlie', note: 'x', pop: 20 }, [113.3, 23.1]),
  feat('f-d', { name: 'Delta', note: null, pop: null }, [114.0, 22.5])
]

const emptyTable: TableViewState = {
  searchQuery: '',
  selectedOnly: false,
  sortField: null,
  sortDirection: 'asc'
}

describe('P13 export scopes / copy / CSV', () => {
  beforeEach(() => {
    useProjectStore.getState()._resetAttributeHistoryForTests()
    useSessionStore.setState({ sessions: {} })
    useProjectStore.setState({
      project: createProject('P13 test'),
      featuresByDataset: {},
      dirty: false,
      selectedLayerId: null,
      selection: { layerId: null, featureIds: [] },
      lastSelectionCountAfterFilter: null
    })
  })

  it('four scopes report correct counts (A / F / S / table)', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    const layer = useProjectStore.getState().project.layers.find((l) => l.id === layerId)!
    useProjectStore.getState().setLayerFilter(layerId, [{ field: 'pop', op: 'gte', value: 20 }])
    useProjectStore.getState().setSelection({ layerId, featureIds: ['f-b'] })
    useSessionStore.getState().setAttributeTableState(layerId, { searchQuery: 'Beta' })

    const allFeatures = useProjectStore.getState().featuresByDataset['ds-1']
    const tableView: TableViewState = {
      searchQuery: 'Beta',
      selectedOnly: false,
      sortField: null,
      sortDirection: 'asc'
    }
    const counts = countExportScopes({
      layer: useProjectStore.getState().project.layers.find((l) => l.id === layerId)!,
      allFeatures,
      selection: useProjectStore.getState().selection,
      tableView
    })
    expect(counts.all).toBe(4)
    expect(counts['layer-filter']).toBe(2) // f-b, f-c
    expect(counts.selection).toBe(1) // f-b
    expect(counts['table-result']).toBe(1) // search Beta within F → f-b
    void layer
  })

  it('snapshot is independent of later source edits', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    const layer = useProjectStore.getState().project.layers.find((l) => l.id === layerId)!
    const allFeatures = useProjectStore.getState().featuresByDataset['ds-1']
    const snap = resolveExportFeatures({
      scope: 'all',
      layer,
      allFeatures,
      selection: useProjectStore.getState().selection,
      tableView: emptyTable
    })
    snap[0].properties.name = 'MUTATED'
    expect(useProjectStore.getState().featuresByDataset['ds-1'][0].properties.name).toBe('Alpha')
  })

  it('GeoJSON round-trip keeps count, coords, and original formula-like strings', () => {
    const text = stringifyGeoJson(sample)
    const parsed = parseGeoJsonFeatures(text)
    expect(parsed.features).toHaveLength(4)
    expect(parsed.features[0].geometry).toEqual(sample[0].geometry)
    expect(parsed.features[0].properties.note).toBe('=1+2')
    // CSV guards formulas; GeoJSON must not
    expect(text).toContain('"=1+2"')
    expect(text).not.toContain("'=1+2")
  })

  it('CSV formula guard + empty scope returns null (no misleading file)', () => {
    expect(featuresToCsv([])).toBeNull()
    const csv = featuresToCsv(sample)
    expect(csv).toBeTruthy()
    expect(csv!).toContain("'=1+2")
  })

  it('copy creates independent Dataset; edit copy ≠ source', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const sourceLayerId = useProjectStore.getState().selectedLayerId!
    useProjectStore.getState().setDirty(false)
    expect(useProjectStore.getState().dirty).toBe(false)

    const sourceFeatures = useProjectStore.getState().getLayerFeatures(sourceLayerId)
    const result = useProjectStore
      .getState()
      .copyFeaturesToLocalLayer(sourceFeatures, 'Cities（副本）', 'point')
    expect(result).not.toBeNull()
    expect(useProjectStore.getState().dirty).toBe(true)
    expect(result!.datasetId).not.toBe('ds-1')
    expect(result!.layerId).not.toBe(sourceLayerId)

    const copyLayerId = result!.layerId
    const copyDs = result!.datasetId
    // mutate copy properties
    const copyFeat = useProjectStore.getState().featuresByDataset[copyDs][0]
    useProjectStore.getState().updateFeatureProperties(copyLayerId, copyFeat.id, {
      ...copyFeat.properties,
      name: 'COPY-EDIT'
    })
    expect(useProjectStore.getState().featuresByDataset['ds-1'][0].properties.name).toBe('Alpha')
    expect(
      useProjectStore.getState().featuresByDataset[copyDs].find((f) => f.id === copyFeat.id)
        ?.properties.name
    ).toBe('COPY-EDIT')

    // object identity must differ
    expect(useProjectStore.getState().featuresByDataset[copyDs][0]).not.toBe(
      useProjectStore.getState().featuresByDataset['ds-1'][0]
    )
  })

  it('cancel path does not set Dirty (dialog open alone is a no-op)', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    useProjectStore.getState().setDirty(false)
    // Opening/closing export dialog never calls store mutations; assert dirty stays false
    // when only reading scopes.
    const layerId = useProjectStore.getState().selectedLayerId!
    const layer = useProjectStore.getState().project.layers.find((l) => l.id === layerId)!
    void resolveExportFeatures({
      scope: 'selection',
      layer,
      allFeatures: useProjectStore.getState().featuresByDataset['ds-1'],
      selection: { layerId, featureIds: [] },
      tableView: emptyTable
    })
    expect(useProjectStore.getState().dirty).toBe(false)
  })

  it('empty selection scope yields 0 features (no file)', () => {
    useProjectStore.getState().addLayer('ds-1', 'Cities', sample, 'point')
    const layerId = useProjectStore.getState().selectedLayerId!
    const layer = useProjectStore.getState().project.layers.find((l) => l.id === layerId)!
    const snap = resolveExportFeatures({
      scope: 'selection',
      layer,
      allFeatures: useProjectStore.getState().featuresByDataset['ds-1'],
      selection: { layerId, featureIds: [] },
      tableView: emptyTable
    })
    expect(snap).toHaveLength(0)
    expect(featuresToCsv(snap)).toBeNull()
  })
})
