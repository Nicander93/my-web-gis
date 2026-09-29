import { create } from 'zustand'
import {
  createProject,
  createDefaultLayerStyle,
  createId,
  cloneValue,
  applyFieldFilter,
  intersectSelectionIds,
  UpdatePropertiesCommand,
  EditHistory,
  MemoryFeatureStore,
  isLegacyStyle,
  migrateLegacyStyle
} from '@desktop-webgis/gis-core'
import type {
  Project,
  Dataset,
  Layer,
  GisFeature,
  SelectionState,
  FieldFilterCondition,
  EditContext
} from '@desktop-webgis/gis-core'
import type { LayerStyle } from '@desktop-webgis/ol-style'

interface ProjectState {
  project: Project
  featuresByDataset: Record<string, GisFeature[]>
  dirty: boolean
  selectedLayerId: string | null
  /** Runtime selection S (by stable Feature ID). */
  selection: SelectionState
  /** Last selection count after filter convergence (for UI). */
  lastSelectionCountAfterFilter: number | null

  addLayer(
    datasetId: string,
    name: string,
    features: GisFeature[],
    styleKind: 'point' | 'line' | 'polygon' | 'mixed'
  ): void
  setSelectedLayer(layerId: string | null): void
  setDirty(dirty: boolean): void
  setLayerStyle(layerId: string, style: LayerStyle): void
  getNormalizedLayerStyle(layerId: string): LayerStyle | null

  getLayerFeatures(layerId: string): GisFeature[]
  getFilteredFeatures(layerId: string): GisFeature[]
  setLayerFilter(layerId: string, filter: FieldFilterCondition[]): void
  clearLayerFilter(layerId: string): void

  setSelection(selection: SelectionState): void
  toggleFeatureSelection(layerId: string, featureId: string, additive?: boolean): void
  selectMatching(layerId: string): void
  clearSelection(): void

  updateFeatureProperties(
    layerId: string,
    featureId: string,
    nextProperties: Record<string, unknown>
  ): boolean
  undoAttributeEdit(): boolean
  redoAttributeEdit(): boolean
  canUndoAttributeEdit(): boolean
  canRedoAttributeEdit(): boolean
  _resetAttributeHistoryForTests(): void
}

const attributeHistory = new EditHistory()
const attributeFeatureStore = new MemoryFeatureStore()

function syncStoreFromState(featuresByDataset: Record<string, GisFeature[]>): void {
  for (const [datasetId, features] of Object.entries(featuresByDataset)) {
    attributeFeatureStore.setAll(datasetId, features)
  }
}

function editContext(): EditContext {
  return { featureStore: attributeFeatureStore }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: createProject(),
  featuresByDataset: {},
  dirty: false,
  selectedLayerId: null,
  selection: { layerId: null, featureIds: [] },
  lastSelectionCountAfterFilter: null,

  addLayer: (datasetId, name, features, styleKind) =>
    set((state) => {
      const dataset: Dataset = {
        id: datasetId,
        name,
        kind: 'vector',
        source: { type: 'memory', label: name }
      }

      const layer: Layer = {
        id: createId('layer'),
        datasetId,
        name,
        visible: true,
        opacity: 1,
        editable: false,
        style: createDefaultLayerStyle(styleKind),
        filter: []
      }

      const featuresByDataset = {
        ...state.featuresByDataset,
        [datasetId]: features
      }
      syncStoreFromState(featuresByDataset)

      return {
        project: {
          ...state.project,
          datasets: [...state.project.datasets, dataset],
          layers: [...state.project.layers, layer]
        },
        featuresByDataset,
        dirty: true,
        selectedLayerId: layer.id
      }
    }),

  setSelectedLayer: (layerId) => set({ selectedLayerId: layerId }),
  setDirty: (dirty) => set({ dirty }),

  setLayerStyle: (layerId, style) =>
    set((state) => ({
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id === layerId ? { ...layer, style: cloneValue(style) } : layer
        )
      },
      dirty: true
    })),

  getNormalizedLayerStyle: (layerId) => {
    const layer = get().project.layers.find((item) => item.id === layerId)
    if (!layer) return null
    return isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : cloneValue(layer.style)
  },

  getLayerFeatures: (layerId) => {
    const layer = get().project.layers.find((item) => item.id === layerId)
    if (!layer) return []
    return get().featuresByDataset[layer.datasetId] ?? []
  },

  getFilteredFeatures: (layerId) => {
    const layer = get().project.layers.find((item) => item.id === layerId)
    if (!layer) return []
    const all = get().featuresByDataset[layer.datasetId] ?? []
    return applyFieldFilter(all, layer.filter)
  },

  setLayerFilter: (layerId, filter) =>
    set((state) => {
      const layers = state.project.layers.map((layer) =>
        layer.id === layerId ? { ...layer, filter: cloneValue(filter) } : layer
      )
      const layer = layers.find((item) => item.id === layerId)
      const all = layer ? (state.featuresByDataset[layer.datasetId] ?? []) : []
      const filtered = applyFieldFilter(all, filter)

      let selection = state.selection
      let lastSelectionCountAfterFilter = state.lastSelectionCountAfterFilter
      if (selection.layerId === layerId) {
        const nextIds = intersectSelectionIds(selection.featureIds, filtered)
        selection = { layerId, featureIds: nextIds }
        lastSelectionCountAfterFilter = nextIds.length
      }

      return {
        project: { ...state.project, layers },
        dirty: true,
        selection,
        lastSelectionCountAfterFilter
      }
    }),

  clearLayerFilter: (layerId) => get().setLayerFilter(layerId, []),

  setSelection: (selection) => {
    const layerId = selection.layerId
    if (!layerId) {
      set({ selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: 0 })
      return
    }
    const filtered = get().getFilteredFeatures(layerId)
    const featureIds = intersectSelectionIds(selection.featureIds, filtered)
    set({
      selection: { layerId, featureIds },
      lastSelectionCountAfterFilter: featureIds.length
    })
  },

  toggleFeatureSelection: (layerId, featureId, additive = true) => {
    const filtered = get().getFilteredFeatures(layerId)
    if (!filtered.some((f) => f.id === featureId)) return

    const current = get().selection
    const sameLayer = current.layerId === layerId
    const existing = sameLayer ? current.featureIds : []
    let next: string[]
    if (existing.includes(featureId)) {
      next = existing.filter((id) => id !== featureId)
    } else if (additive) {
      next = [...existing, featureId]
    } else {
      next = [featureId]
    }
    set({
      selection: { layerId, featureIds: next },
      lastSelectionCountAfterFilter: next.length
    })
  },

  selectMatching: (layerId) => {
    const filtered = get().getFilteredFeatures(layerId)
    const featureIds = filtered.map((f) => f.id)
    set({
      selection: { layerId, featureIds },
      lastSelectionCountAfterFilter: featureIds.length
    })
  },

  clearSelection: () =>
    set({ selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: 0 }),

  updateFeatureProperties: (layerId, featureId, nextProperties) => {
    const state = get()
    const layer = state.project.layers.find((item) => item.id === layerId)
    if (!layer) return false
    const features = state.featuresByDataset[layer.datasetId] ?? []
    const feature = features.find((item) => item.id === featureId)
    if (!feature) return false

    syncStoreFromState(state.featuresByDataset)
    const before = cloneValue(feature.properties)
    const after = cloneValue(nextProperties)
    attributeHistory.execute(
      new UpdatePropertiesCommand(createId('cmd'), layer.datasetId, featureId, before, after),
      editContext()
    )

    const nextFeatures = attributeFeatureStore.getAll(layer.datasetId)
    set({
      featuresByDataset: {
        ...state.featuresByDataset,
        [layer.datasetId]: nextFeatures
      },
      dirty: true
    })

    // Re-converge selection against recomputed F after attribute change.
    get().setLayerFilter(layerId, layer.filter ?? [])
    return true
  },

  undoAttributeEdit: () => {
    const state = get()
    syncStoreFromState(state.featuresByDataset)
    const command = attributeHistory.undo(editContext())
    if (!command) return false

    const snapshot = attributeFeatureStore.snapshot()
    set({
      featuresByDataset: { ...state.featuresByDataset, ...snapshot },
      dirty: true
    })

    // Refresh F/S derived display for all layers whose datasets changed.
    for (const layer of get().project.layers) {
      if (snapshot[layer.datasetId]) {
        get().setLayerFilter(layer.id, layer.filter ?? [])
      }
    }
    return true
  },

  redoAttributeEdit: () => {
    const state = get()
    syncStoreFromState(state.featuresByDataset)
    const command = attributeHistory.redo(editContext())
    if (!command) return false

    const snapshot = attributeFeatureStore.snapshot()
    set({
      featuresByDataset: { ...state.featuresByDataset, ...snapshot },
      dirty: true
    })
    for (const layer of get().project.layers) {
      if (snapshot[layer.datasetId]) {
        get().setLayerFilter(layer.id, layer.filter ?? [])
      }
    }
    return true
  },

  canUndoAttributeEdit: () => attributeHistory.canUndo,
  canRedoAttributeEdit: () => attributeHistory.canRedo,

  _resetAttributeHistoryForTests: () => {
    attributeHistory.clear()
  }
}))
