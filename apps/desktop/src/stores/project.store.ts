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
  migrateLegacyStyle,
  normalizeLayerTree,
  flattenLayerIds,
  createLayerGroup,
  findGroupForLayer,
  layersWithEffectiveVisibility,
  SetLayerStyleCommand,
  SetLayerFilterCommand,
  SetLayerOpacityCommand,
  SetLayerTreeCommand,
  snapshotLayerTree
} from '@desktop-webgis/gis-core'
import type {
  Project,
  Dataset,
  Layer,
  LayerGroup,
  LayerTreeEntry,
  GisFeature,
  SelectionState,
  FieldFilterCondition,
  ServiceSource,
  DatasetKind,
  ProjectSnapshot,
  ProjectEditContext
} from '@desktop-webgis/gis-core'
import { useSessionStore } from '@/stores/session.store'
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
  /**
   * Copy features into a brand-new Dataset + Layer (deep-cloned; no shared mutable refs).
   */
  copyFeaturesToLocalLayer(
    features: GisFeature[],
    name: string,
    styleKind: 'point' | 'line' | 'polygon' | 'mixed'
  ): { datasetId: string; layerId: string } | null
  /**
   * Add a service Dataset + Layer from a connection selection.
   * Does not dump the remote catalog — only the caller-selected layer/typeName.
   * Never stores secret token values (credentialRef only). Forces editable=false.
   */
  addServiceLayer(input: {
    name: string
    kind: Exclude<DatasetKind, 'vector'>
    source: ServiceSource
  }): { datasetId: string; layerId: string } | null
  setSelectedLayer(layerId: string | null): void
  setDirty(dirty: boolean): void
  /** Replace project + features (open / new). Clears edit history. */
  loadSnapshot(snapshot: ProjectSnapshot): void
  getSnapshot(): ProjectSnapshot
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
  /** Unified EditCommand undo (style/filter/opacity/tree + attributes). */
  undoEdit(): boolean
  redoEdit(): boolean
  canUndoEdit(): boolean
  canRedoEdit(): boolean
  _resetAttributeHistoryForTests(): void
  _resetProjectHistoryForTests(): void

  /** Ordered layers for map sync (list top → bottom) with effective visibility. */
  getMapLayers(): Layer[]
  setLayerVisible(layerId: string, visible: boolean): void
  setLayerOpacity(layerId: string, opacity: number): void
  setGroupVisible(groupId: string, visible: boolean): void
  renameLayer(layerId: string, name: string): void
  renameGroup(groupId: string, name: string): void
  moveLayer(layerId: string, direction: 'up' | 'down'): void
  moveRootEntry(entry: LayerTreeEntry, direction: 'up' | 'down'): void
  createGroup(name?: string, layerIds?: string[]): string | null
  /** removeChildren=false keeps children as ungrouped top-level layers. */
  removeGroup(groupId: string, removeChildren: boolean): void
  /**
   * Remove a layer and clean selection / session drafts / group refs / orphan dataset.
   * Returns false if layer missing.
   */
  removeLayer(layerId: string): boolean
  /** Move a layer before/after a target (root or inside a group). */
  relocateLayer(
    layerId: string,
    target: { kind: 'root'; index: number } | { kind: 'group'; groupId: string; index: number }
  ): void
  addLayersToGroup(groupId: string, layerIds: string[]): void
  /** Replace features for a dataset (WFS snapshot apply / refresh). */
  setDatasetFeatures(datasetId: string, features: GisFeature[]): void
  /** Patch WFS service source metadata after load/refresh (no secrets). */
  patchWfsServiceSource(
    datasetId: string,
    patch: Partial<Extract<ServiceSource, { type: "wfs" }>>
  ): void
}

const editHistory = new EditHistory()
const attributeFeatureStore = new MemoryFeatureStore()

function syncStoreFromState(featuresByDataset: Record<string, GisFeature[]>): void {
  for (const [datasetId, features] of Object.entries(featuresByDataset)) {
    attributeFeatureStore.setAll(datasetId, features)
  }
}

export const useProjectStore = create<ProjectState>((set, get) => {
  function projectEditContext(): ProjectEditContext {
    return {
      featureStore: attributeFeatureStore,
      getProject: () => get().project,
      replaceProject: (project) => {
        set({ project: normalizeLayerTree(project), dirty: true })
      }
    }
  }

  function reconvergeSelection(layerId: string): void {
    const state = get()
    if (state.selection.layerId !== layerId) return
    const filtered = state.getFilteredFeatures(layerId)
    const nextIds = intersectSelectionIds(state.selection.featureIds, filtered)
    set({
      selection: { layerId, featureIds: nextIds },
      lastSelectionCountAfterFilter: nextIds.length
    })
  }

  return {
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

      const project = normalizeLayerTree({
        ...state.project,
        datasets: [...state.project.datasets, dataset],
        layers: [...state.project.layers, layer],
        groups: state.project.groups ?? [],
        rootOrder: [
          ...(state.project.rootOrder ?? []),
          { type: 'layer', id: layer.id }
        ]
      })

      return {
        project,
        featuresByDataset,
        dirty: true,
        selectedLayerId: layer.id
      }
    }),

  setDatasetFeatures: (datasetId, features) =>
    set((state) => {
      const featuresByDataset = {
        ...state.featuresByDataset,
        [datasetId]: features
      }
      syncStoreFromState(featuresByDataset)
      return { featuresByDataset, dirty: true }
    }),

  patchWfsServiceSource: (datasetId, patch) =>
    set((state) => {
      const datasets = state.project.datasets.map((ds) => {
        if (ds.id !== datasetId || ds.kind !== "wfs") return ds
        return {
          ...ds,
          source: { ...ds.source, ...patch, type: "wfs" as const }
        }
      })
      return {
        project: { ...state.project, datasets },
        dirty: true
      }
    }),

  copyFeaturesToLocalLayer: (features, name, styleKind) => {
    if (!features || features.length === 0) return null
    const datasetId = createId('dataset')
    const cloned = cloneValue(features)
    // Ensure we never share object identity with source features.
    get().addLayer(datasetId, name, cloned, styleKind)
    const layerId = get().selectedLayerId
    if (!layerId) return null
    return { datasetId, layerId }
  },

  addServiceLayer: (input) => {
    if (!input.name.trim()) return null
    if (input.kind === 'wms' && input.source.type !== 'wms') return null
    if (input.kind === 'wmts' && input.source.type !== 'wmts') return null
    if (input.kind === 'wfs' && input.source.type !== 'wfs') return null

    const datasetId = createId('dataset')
    const layerId = createId('layer')
    const dataset = {
      id: datasetId,
      name: input.name,
      kind: input.kind,
      source: cloneValue(input.source)
    } as Dataset

    const layer: Layer = {
      id: layerId,
      datasetId,
      name: input.name,
      visible: true,
      opacity: 1,
      editable: false,
      style: createDefaultLayerStyle('mixed'),
      filter: []
    }

    set((state) => {
      const project = normalizeLayerTree({
        ...state.project,
        datasets: [...state.project.datasets, dataset],
        layers: [...state.project.layers, layer],
        groups: state.project.groups ?? [],
        rootOrder: [...(state.project.rootOrder ?? []), { type: 'layer', id: layer.id }]
      })
      return {
        project,
        dirty: true,
        selectedLayerId: layer.id
      }
    })

    return { datasetId, layerId }
  },

  setSelectedLayer: (layerId) => set({ selectedLayerId: layerId }),
  setDirty: (dirty) => set({ dirty }),

  loadSnapshot: (snapshot) => {
    editHistory.clear()
    const project = normalizeLayerTree(cloneValue(snapshot.project))
    const featuresByDataset = cloneValue(snapshot.featuresByDataset ?? {})
    syncStoreFromState(featuresByDataset)
    for (const layerId of Object.keys(useSessionStore.getState().sessions)) {
      if (!project.layers.some((l) => l.id === layerId)) {
        useSessionStore.getState().clearLayerSession(layerId)
      }
    }
    set({
      project,
      featuresByDataset,
      dirty: false,
      selectedLayerId: null,
      selection: { layerId: null, featureIds: [] },
      lastSelectionCountAfterFilter: null
    })
  },

  getSnapshot: () => ({
    project: cloneValue(get().project),
    featuresByDataset: cloneValue(get().featuresByDataset)
  }),

  setLayerStyle: (layerId, style) => {
    const state = get()
    const layer = state.project.layers.find((item) => item.id === layerId)
    if (!layer) return
    const before = isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : cloneValue(layer.style)
    const after = cloneValue(style)
    editHistory.execute(
      new SetLayerStyleCommand(createId('cmd'), layerId, before, after),
      projectEditContext()
    )
  },

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

  setLayerFilter: (layerId, filter) => {
    const state = get()
    const layer = state.project.layers.find((item) => item.id === layerId)
    if (!layer) return
    const before = cloneValue(layer.filter ?? [])
    const after = cloneValue(filter)
    // Skip no-op to avoid polluting history when reconverging after attribute edits.
    if (JSON.stringify(before) === JSON.stringify(after)) {
      reconvergeSelection(layerId)
      return
    }
    editHistory.execute(
      new SetLayerFilterCommand(createId('cmd'), layerId, before, after),
      projectEditContext()
    )
    reconvergeSelection(layerId)
  },

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
    editHistory.execute(
      new UpdatePropertiesCommand(createId('cmd'), layer.datasetId, featureId, before, after),
      projectEditContext()
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

  undoEdit: () => {
    const state = get()
    syncStoreFromState(state.featuresByDataset)
    const command = editHistory.undo(projectEditContext())
    if (!command) return false
    const snapshot = attributeFeatureStore.snapshot()
    set({
      featuresByDataset: { ...get().featuresByDataset, ...snapshot },
      dirty: true
    })
    for (const layer of get().project.layers) {
      reconvergeSelection(layer.id)
    }
    return true
  },

  redoEdit: () => {
    const state = get()
    syncStoreFromState(state.featuresByDataset)
    const command = editHistory.redo(projectEditContext())
    if (!command) return false
    const snapshot = attributeFeatureStore.snapshot()
    set({
      featuresByDataset: { ...get().featuresByDataset, ...snapshot },
      dirty: true
    })
    for (const layer of get().project.layers) {
      reconvergeSelection(layer.id)
    }
    return true
  },

  canUndoEdit: () => editHistory.canUndo,
  canRedoEdit: () => editHistory.canRedo,

  undoAttributeEdit: () => get().undoEdit(),
  redoAttributeEdit: () => get().redoEdit(),
  canUndoAttributeEdit: () => get().canUndoEdit(),
  canRedoAttributeEdit: () => get().canRedoEdit(),


  getMapLayers: () => layersWithEffectiveVisibility(get().project),

  setLayerVisible: (layerId, visible) =>
    set((state) => ({
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id === layerId ? { ...layer, visible } : layer
        )
      },
      dirty: true
    })),

  setLayerOpacity: (layerId, opacity) => {
    const state = get()
    const layer = state.project.layers.find((item) => item.id === layerId)
    if (!layer) return
    const next = Math.min(1, Math.max(0, opacity))
    if (layer.opacity === next) return
    editHistory.execute(
      new SetLayerOpacityCommand(createId('cmd'), layerId, layer.opacity, next),
      projectEditContext()
    )
  },

  setGroupVisible: (groupId, visible) =>
    set((state) => ({
      project: normalizeLayerTree({
        ...state.project,
        groups: (state.project.groups ?? []).map((group) =>
          group.id === groupId ? { ...group, visible } : group
        )
      }),
      dirty: true
    })),

  renameLayer: (layerId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((state) => ({
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id === layerId ? { ...layer, name: trimmed } : layer
        )
      },
      dirty: true
    }))
  },

  renameGroup: (groupId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((state) => ({
      project: normalizeLayerTree({
        ...state.project,
        groups: (state.project.groups ?? []).map((group) =>
          group.id === groupId ? { ...group, name: trimmed } : group
        )
      }),
      dirty: true
    }))
  },

  moveRootEntry: (entry, direction) =>
    set((state) => {
      const project = normalizeLayerTree(state.project)
      const order = [...(project.rootOrder ?? [])]
      const index = order.findIndex((item) => item.type === entry.type && item.id === entry.id)
      if (index < 0) return state
      const swapWith = direction === 'up' ? index - 1 : index + 1
      if (swapWith < 0 || swapWith >= order.length) return state
      ;[order[index], order[swapWith]] = [order[swapWith]!, order[index]!]
      return {
        project: { ...project, rootOrder: order },
        dirty: true
      }
    }),

  moveLayer: (layerId, direction) => {
    const state = get()
    const project = normalizeLayerTree(state.project)
    const group = findGroupForLayer(project, layerId)
    if (group) {
      const ids = [...group.layerIds]
      const index = ids.indexOf(layerId)
      const swapWith = direction === 'up' ? index - 1 : index + 1
      if (index < 0 || swapWith < 0 || swapWith >= ids.length) {
        // At group edge: move out to root before/after the group.
        const rootIndex = (project.rootOrder ?? []).findIndex(
          (e) => e.type === 'group' && e.id === group.id
        )
        if (rootIndex < 0) return
        const insertAt = direction === 'up' ? rootIndex : rootIndex + 1
        const nextGroupIds = ids.filter((id) => id !== layerId)
        const nextGroups = (project.groups ?? []).map((g) =>
          g.id === group.id ? { ...g, layerIds: nextGroupIds } : g
        )
        const nextRoot = [...(project.rootOrder ?? [])]
        nextRoot.splice(insertAt, 0, { type: 'layer', id: layerId })
        set({
          project: normalizeLayerTree({
            ...project,
            groups: nextGroups,
            rootOrder: nextRoot
          }),
          dirty: true
        })
        return
      }
      ;[ids[index], ids[swapWith]] = [ids[swapWith]!, ids[index]!]
      set({
        project: normalizeLayerTree({
          ...project,
          groups: (project.groups ?? []).map((g) =>
            g.id === group.id ? { ...g, layerIds: ids } : g
          )
        }),
        dirty: true
      })
      return
    }
    get().moveRootEntry({ type: 'layer', id: layerId }, direction)
  },

  createGroup: (name = '新建组', layerIds = []) => {
    const beforeTree = snapshotLayerTree(get().project)
    const state = get()
    const project = normalizeLayerTree(state.project)
    const validIds = layerIds.filter((id) => project.layers.some((l) => l.id === id))
    const group = createLayerGroup(name, validIds)

    // Remove members from other groups / root.
    let groups = (project.groups ?? []).map((g) => ({
      ...g,
      layerIds: g.layerIds.filter((id) => !validIds.includes(id))
    }))
    groups = [...groups, group]
    const rootOrder = [
      { type: 'group' as const, id: group.id },
      ...(project.rootOrder ?? []).filter(
        (entry) => !(entry.type === 'layer' && validIds.includes(entry.id))
      )
    ]

    const afterProject = normalizeLayerTree({ ...project, groups, rootOrder })
    editHistory.execute(
      new SetLayerTreeCommand(
        createId('cmd'),
        '创建图层组',
        beforeTree,
        snapshotLayerTree(afterProject)
      ),
      projectEditContext()
    )
    return group.id
  },

  removeGroup: (groupId, removeChildren) => {
    const state = get()
    const project = normalizeLayerTree(state.project)
    const group = (project.groups ?? []).find((g) => g.id === groupId)
    if (!group) return

    if (removeChildren) {
      for (const layerId of [...group.layerIds]) {
        get().removeLayer(layerId)
      }
      // refresh after removals
      const after = normalizeLayerTree(get().project)
      set({
        project: normalizeLayerTree({
          ...after,
          groups: (after.groups ?? []).filter((g) => g.id !== groupId),
          rootOrder: (after.rootOrder ?? []).filter((e) => !(e.type === 'group' && e.id === groupId))
        }),
        dirty: true
      })
      return
    }

    // Keep children: insert them in place of the group in rootOrder.
    const rootOrder: LayerTreeEntry[] = []
    for (const entry of project.rootOrder ?? []) {
      if (entry.type === 'group' && entry.id === groupId) {
        for (const layerId of group.layerIds) {
          rootOrder.push({ type: 'layer', id: layerId })
        }
        continue
      }
      rootOrder.push(entry)
    }
    set({
      project: normalizeLayerTree({
        ...project,
        groups: (project.groups ?? []).filter((g) => g.id !== groupId),
        rootOrder
      }),
      dirty: true
    })
  },

  removeLayer: (layerId) => {
    const state = get()
    const project = normalizeLayerTree(state.project)
    const layer = project.layers.find((item) => item.id === layerId)
    if (!layer) return false

    const datasetId = layer.datasetId
    const layers = project.layers.filter((item) => item.id !== layerId)
    const groups = (project.groups ?? []).map((g) => ({
      ...g,
      layerIds: g.layerIds.filter((id) => id !== layerId)
    }))
    const rootOrder = (project.rootOrder ?? []).filter(
      (entry) => !(entry.type === 'layer' && entry.id === layerId)
    )

    const datasetStillUsed = layers.some((item) => item.datasetId === datasetId)
    const datasets = datasetStillUsed
      ? project.datasets
      : project.datasets.filter((item) => item.id !== datasetId)
    const featuresByDataset = { ...state.featuresByDataset }
    if (!datasetStillUsed) {
      delete featuresByDataset[datasetId]
    }

    const selection =
      state.selection.layerId === layerId
        ? { layerId: null as string | null, featureIds: [] as string[] }
        : state.selection

    useSessionStore.getState().clearLayerSession(layerId)

    set({
      project: normalizeLayerTree({
        ...project,
        layers,
        datasets,
        groups,
        rootOrder
      }),
      featuresByDataset,
      dirty: true,
      selectedLayerId: state.selectedLayerId === layerId ? null : state.selectedLayerId,
      selection,
      lastSelectionCountAfterFilter:
        state.selection.layerId === layerId ? 0 : state.lastSelectionCountAfterFilter
    })
    return true
  },

  relocateLayer: (layerId, target) =>
    set((state) => {
      const project = normalizeLayerTree(state.project)
      if (!project.layers.some((l) => l.id === layerId)) return state

      // Detach from current group / root.
      let groups = (project.groups ?? []).map((g) => ({
        ...g,
        layerIds: g.layerIds.filter((id) => id !== layerId)
      }))
      let rootOrder = (project.rootOrder ?? []).filter(
        (entry) => !(entry.type === 'layer' && entry.id === layerId)
      )

      if (target.kind === 'root') {
        const index = Math.max(0, Math.min(target.index, rootOrder.length))
        rootOrder = [
          ...rootOrder.slice(0, index),
          { type: 'layer', id: layerId },
          ...rootOrder.slice(index)
        ]
      } else {
        groups = groups.map((g) => {
          if (g.id !== target.groupId) return g
          const ids = [...g.layerIds]
          const index = Math.max(0, Math.min(target.index, ids.length))
          ids.splice(index, 0, layerId)
          return { ...g, layerIds: ids }
        })
      }

      return {
        project: normalizeLayerTree({ ...project, groups, rootOrder }),
        dirty: true
      }
    }),

  addLayersToGroup: (groupId, layerIds) =>
    set((state) => {
      const project = normalizeLayerTree(state.project)
      if (!project.groups.some((g) => g.id === groupId)) return state
      const valid = layerIds.filter((id) => project.layers.some((l) => l.id === id))
      let groups = (project.groups ?? []).map((g) => ({
        ...g,
        layerIds: g.layerIds.filter((id) => !valid.includes(id))
      }))
      groups = groups.map((g) =>
        g.id === groupId ? { ...g, layerIds: [...g.layerIds, ...valid] } : g
      )
      const rootOrder = (project.rootOrder ?? []).filter(
        (entry) => !(entry.type === 'layer' && valid.includes(entry.id))
      )
      return {
        project: normalizeLayerTree({ ...project, groups, rootOrder }),
        dirty: true
      }
    }),

  _resetAttributeHistoryForTests: () => {
    editHistory.clear()
  },

  _resetProjectHistoryForTests: () => {
    editHistory.clear()
  }

}})
