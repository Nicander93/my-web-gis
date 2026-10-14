import { create } from 'zustand'
import { useWorkbenchStore } from './workbench.store'
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
  getLayerTreeChildren,
  getLayerGroupState,
  getEffectiveLocked,
  moveLayerTreeEntry,
  dissolveLayerGroup,
  SetLayerStyleCommand,
  SetLayerFilterCommand,
  SetLayerOpacityCommand,
  SetLayerTreeCommand,
  SetDatasetContentCommand,
  ReplaceProjectSnapshotCommand,
  ApplyProjectSnapshotEditCommand,
  getProjectSnapshotChanges,
  AddLocalLayerCommand,
  snapshotLayerTree,
  capabilitiesForDataset
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
  ProjectEditContext,
  EditCommand,
  ProcessingRecord
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
    styleKind: 'point' | 'line' | 'polygon' | 'mixed',
    processing?: ProcessingRecord
  ): void
  /**
   * Copy features into a brand-new Dataset + Layer (deep-cloned; no shared mutable refs).
   */
  copyFeaturesToLocalLayer(
    features: GisFeature[],
    name: string,
    styleKind: 'point' | 'line' | 'polygon' | 'mixed',
    processing?: ProcessingRecord
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
  /** Whole-content replacement in the shared edit history, preserving prior undo entries. */
  replaceSnapshotAsEdit(snapshot: ProjectSnapshot, label: string): boolean
  /** Same-project API edit; retains unaffected selection, table targets and drafts. */
  applySnapshotAsEdit(snapshot: ProjectSnapshot, label: string): boolean
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
  getHistoryBlockReason(direction: 'undo' | 'redo'): string | null
  canUndoEdit(): boolean
  canRedoEdit(): boolean
  /** Apply a feature/geometry EditCommand (draw / modify / delete from OlToolRuntime). */
  executeEditCommand(command: EditCommand): boolean
  executeEditCommands(commands: EditCommand[]): boolean
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
  createGroup(name?: string, layerIds?: string[], parentId?: string): string | null
  relocateGroup(groupId: string, parentId?: string, index?: number): void
  setGroupLocked(groupId: string, locked: boolean): void
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
        const previous = get().project
        for (const layer of project.layers) {
          if (JSON.stringify(layer.style) === JSON.stringify(previous.layers.find((item) => item.id === layer.id)?.style)) continue
          const session = useSessionStore.getState().sessions[layer.id]
          if (session?.styleDraft && !session.styleDraft.dirty) {
            const { styleDraft: _draft, ...retained } = session
            useSessionStore.setState((state) => ({ sessions: { ...state.sessions, [layer.id]: retained } }))
          }
        }
        set({ project: normalizeLayerTree(project), dirty: true })
      },
      onDatasetFieldChange: (datasetId, from, to) => {
        if (!from) return
        const session = useSessionStore.getState()
        for (const layer of get().project.layers.filter((item) => item.datasetId === datasetId)) {
          const table = session.sessions[layer.id]?.attributeTable
          if (!table) continue
          const mapNames = (names: string[]) => names.flatMap((name) => name === from ? to ? [to] : [] : [name])
          session.setAttributeTableState(layer.id, {
            sortField: to && table.sortField === from ? to : table.sortField,
            statsField: to && table.statsField === from ? to : table.statsField,
            fieldOrder: to ? mapNames(table.fieldOrder ?? []) : table.fieldOrder,
            hiddenFields: to ? mapNames(table.hiddenFields ?? []) : table.hiddenFields,
            ...(table.filterDraft ? { filterDraft: table.filterDraft.flatMap((condition) => condition.field === from
              ? to ? [{ ...condition, field: to }] : [] : [condition]) } : {})
          })
        }
      },
      applySnapshotEdit: (snapshot) => {
        const state = get(), changes = getProjectSnapshotChanges(state.getSnapshot(), snapshot)
        const session = useSessionStore.getState(), workbench = useWorkbenchStore.getState()
        const stale = new Set([...changes.removedLayers, ...changes.dataChangedLayers])
        const guarded = new Set([...stale, ...changes.styleChangedLayers])
        if ([...guarded].some(id => session.sessions[id]?.styleDraft?.dirty)) throw new Error('请先应用或放弃受影响图层的样式草稿')
        const sessions = { ...session.sessions }
        for (const id of stale) { session.abortWfsLoad(id); delete sessions[id] }
        for (const id of changes.styleChangedLayers) {
          if (!sessions[id]) continue
          const { styleDraft: _draft, ...retained } = sessions[id]
          sessions[id] = retained
        }
        if (workbench.editLayerId && stale.has(workbench.editLayerId)) { workbench.setEditLayer(null); workbench.setActiveTool('none') }
        for (const id of changes.removedLayers) workbench.clearLayer(id)
        useSessionStore.setState({ sessions })
        const project = normalizeLayerTree(cloneValue(snapshot.project)), featuresByDataset = cloneValue(snapshot.featuresByDataset)
        const selectedLayerId = project.layers.some(layer => layer.id === state.selectedLayerId) ? state.selectedLayerId : null
        const selected = project.layers.find(layer => layer.id === state.selection.layerId)
        const selection = selected ? { layerId: selected.id, featureIds: intersectSelectionIds(state.selection.featureIds,
          applyFieldFilter(featuresByDataset[selected.datasetId] ?? [], selected.filter)) } : { layerId: null, featureIds: [] }
        set({ project, featuresByDataset, selectedLayerId, selection, dirty: true, lastSelectionCountAfterFilter: selected ? selection.featureIds.length : null })
      },
      replaceSnapshot: (snapshot) => {
        const project = normalizeLayerTree(cloneValue(snapshot.project))
        useSessionStore.getState().bumpWfsLoadGeneration()
        useWorkbenchStore.getState().reset()
        // Layer IDs can be reused by another scene; cached inspectors belong to the old content.
        useSessionStore.setState({ sessions: {}, inspectorTab: 'layer' })
        set({ project, featuresByDataset: cloneValue(snapshot.featuresByDataset), dirty: true, selectedLayerId: null,
          selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: null })
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

  function editedFeatures(): Record<string, GisFeature[]> {
    const ids = new Set(get().project.datasets.map(dataset => dataset.id))
    return Object.fromEntries(Object.entries({ ...get().featuresByDataset, ...attributeFeatureStore.snapshot() }).filter(([id]) => ids.has(id)))
  }

  return {
  project: createProject(),
  featuresByDataset: {},
  dirty: false,
  selectedLayerId: null,
  selection: { layerId: null, featureIds: [] },
  lastSelectionCountAfterFilter: null,

  addLayer: (datasetId, name, features, styleKind, processing) =>
    set((state) => {
      const dataset: Dataset = {
        id: datasetId,
        name,
        kind: 'vector',
        source: { type: 'memory', label: name },
        ...(processing ? { processing: cloneValue(processing) } : {})
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

  copyFeaturesToLocalLayer: (features, name, styleKind, processing) => {
    if (!features || features.length === 0) return null
    const datasetId = createId('dataset')
    const layerId = createId('layer')
    const dataset: Extract<Dataset, { kind: 'vector' }> = { id: datasetId, name, kind: 'vector', source: { type: 'memory', label: name }, ...(processing ? { processing: cloneValue(processing) } : {}) }
    const layer: Layer = { id: layerId, datasetId, name, visible: true, opacity: 1, editable: false, style: createDefaultLayerStyle(styleKind), filter: [] }
    const beforeLayer = get().selectedLayerId, beforeSelection = cloneValue(get().selection)
    const command = new AddLocalLayerCommand(createId('cmd'), dataset, layer, features)
    get().executeEditCommand({ id: command.id, label: command.label,
      execute: context => { command.execute(context); set({ selectedLayerId: layerId, selection: { layerId: null, featureIds: [] } }) },
      undo: context => {
        command.undo(context)
        const existing = get().project.layers
        set({ selectedLayerId: existing.some(layer => layer.id === beforeLayer) ? beforeLayer : null,
          selection: existing.some(layer => layer.id === beforeSelection.layerId) ? cloneValue(beforeSelection) : { layerId: null, featureIds: [] } })
      }
    })
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
    useSessionStore.setState({ inspectorTab: 'layer' })
    useWorkbenchStore.getState().reset()
    editHistory.clear()
    const project = normalizeLayerTree(cloneValue(snapshot.project))
    const featuresByDataset = cloneValue(snapshot.featuresByDataset ?? {})
    syncStoreFromState(featuresByDataset)
    useSessionStore.setState({ sessions: {} })
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
  applySnapshotAsEdit: (snapshot, label) => {
    const before = get().getSnapshot()
    if (JSON.stringify(before) === JSON.stringify(snapshot)) return false
    const command = new ApplyProjectSnapshotEditCommand(createId('cmd'), label, before, snapshot)
    if (command.guardedLayerIds.some(id => useSessionStore.getState().sessions[id]?.styleDraft?.dirty)) throw new Error('请先应用或放弃受影响图层的样式草稿')
    return get().executeEditCommand(command)
  },
  replaceSnapshotAsEdit: (snapshot, label) => {
    if (Object.values(useSessionStore.getState().sessions).some(session => session.styleDraft?.dirty)) throw new Error('请先应用或放弃样式草稿，再替换场景')
    const before = get().getSnapshot()
    if (JSON.stringify(before) === JSON.stringify(snapshot)) return false
    return get().executeEditCommand(new ReplaceProjectSnapshotCommand(createId('cmd'), label, before, snapshot))
  },

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
    if (!layer || getEffectiveLocked(state.project, layerId)) return false
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
    if (get().getHistoryBlockReason('undo')) return false
    const state = get()
    syncStoreFromState(state.featuresByDataset)
    const command = editHistory.undo(projectEditContext())
    if (!command) return false
    const snapshot = editedFeatures()
    set({
      featuresByDataset: snapshot,
      dirty: true
    })
    for (const layer of get().project.layers) {
      reconvergeSelection(layer.id)
    }
    return true
  },

  redoEdit: () => {
    if (get().getHistoryBlockReason('redo')) return false
    const state = get()
    syncStoreFromState(state.featuresByDataset)
    const command = editHistory.redo(projectEditContext())
    if (!command) return false
    const snapshot = editedFeatures()
    set({
      featuresByDataset: snapshot,
      dirty: true
    })
    for (const layer of get().project.layers) {
      reconvergeSelection(layer.id)
    }
    return true
  },

  canUndoEdit: () => editHistory.canUndo,
  getHistoryBlockReason: (direction) => {
    const command = direction === 'undo' ? editHistory.peekUndo() : editHistory.peekRedo()
    if (command instanceof SetDatasetContentCommand && command.guardedLayerIds.some(id => useSessionStore.getState().sessions[id]?.styleDraft?.dirty))
      return '请先应用或放弃受影响图层的样式草稿，再恢复字段编辑'
    if (command instanceof ApplyProjectSnapshotEditCommand) return command.guardedLayerIds.some(id => useSessionStore.getState().sessions[id]?.styleDraft?.dirty)
      ? '请先应用或放弃受影响图层的样式草稿，再恢复内容编辑' : null
    return command instanceof ReplaceProjectSnapshotCommand && Object.values(useSessionStore.getState().sessions).some(session => session.styleDraft?.dirty)
      ? '请先应用或放弃样式草稿，再恢复场景内容' : null
  },
  canRedoEdit: () => editHistory.canRedo,

  executeEditCommand: (command) => {
    if (command instanceof SetDatasetContentCommand && command.guardedLayerIds.some(id => useSessionStore.getState().sessions[id]?.styleDraft?.dirty))
      throw new Error('请先应用或放弃受影响图层的样式草稿，再修改字段')
    const state = get()
    syncStoreFromState(state.featuresByDataset)
    editHistory.execute(command, projectEditContext())
    const snapshot = editedFeatures()
    set({
      featuresByDataset: snapshot,
      dirty: true
    })
    for (const layer of get().project.layers) {
      reconvergeSelection(layer.id)
    }
    return true
  },

  executeEditCommands: (commands) => {
    if (commands.length === 0) return false
    let ok = false
    for (const command of commands) {
      if (get().executeEditCommand(command)) ok = true
    }
    return ok
  },

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

  setGroupVisible: (id, visible) => {
    const state = get(), project = structuredClone(state.project), group = project.groups.find(group => group.id === id)
    if (!group || group.visible === visible) return
    group.visible = visible
    state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '设置文件夹显隐', snapshotLayerTree(state.project), snapshotLayerTree(project)))
  },
  setGroupLocked: (id, locked) => {
    const state = get(), project = structuredClone(state.project), group = project.groups.find(group => group.id === id)
    if (!group) return
    if (getLayerGroupState(project, group.parentId).locked) throw new Error('请先解锁父文件夹')
    group.locked = locked
    state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '设置文件夹锁定', snapshotLayerTree(state.project), snapshotLayerTree(project)))
  },
  renameLayer: (id, name) => {
    const state = get(), project = structuredClone(state.project), layer = project.layers.find(layer => layer.id === id)
    if (!layer || !name.trim() || layer.name === name.trim()) return
    if (getEffectiveLocked(project, id)) throw new Error('父文件夹已锁定')
    layer.name = name.trim()
    state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '重命名图层', snapshotLayerTree(state.project), snapshotLayerTree(project)))
  },
  renameGroup: (id, name) => {
    const state = get(), project = structuredClone(state.project), group = project.groups.find(group => group.id === id)
    if (!group || !name.trim() || group.name === name.trim()) return
    if (getLayerGroupState(project, id).locked) throw new Error('文件夹或其父级已锁定')
    group.name = name.trim()
    state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '重命名文件夹', snapshotLayerTree(state.project), snapshotLayerTree(project)))
  },
  moveRootEntry: (entry, direction) => {
    const state = get(), project = normalizeLayerTree(state.project)
    const parent = entry.type === 'group' ? project.groups.find(group => group.id === entry.id)?.parentId : findGroupForLayer(project, entry.id)?.id
    const siblings = getLayerTreeChildren(project, parent), index = siblings.findIndex(item => item.type === entry.type && item.id === entry.id)
    const target = index + (direction === 'up' ? -1 : 1)
    if (index < 0 || target < 0 || target >= siblings.length) return
    const after = moveLayerTreeEntry(project, entry, parent, target)
    state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '调整树对象顺序', snapshotLayerTree(project), snapshotLayerTree(after)))
  },
  moveLayer: (id, direction) => get().moveRootEntry({ type: 'layer', id }, direction),
  relocateGroup: (id, parentId, index) => {
    const state = get(), after = moveLayerTreeEntry(state.project, { type: 'group', id }, parentId, index)
    state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '移动文件夹', snapshotLayerTree(state.project), snapshotLayerTree(after)))
  },
  createGroup: (name = '新建组', ids = [], parentId) => {
    const state = get(), before = normalizeLayerTree(state.project)
    if (getLayerGroupState(before, parentId).locked) throw new Error('目标文件夹或其父级已锁定')
    const group = createLayerGroup(name.trim() || '新建文件夹')
    let after = normalizeLayerTree({ ...structuredClone(before), groups: [...before.groups, group] })
    after = moveLayerTreeEntry(after, { type: 'group', id: group.id }, parentId, 0)
    for (const id of ids) if (before.layers.some(layer => layer.id === id)) after = moveLayerTreeEntry(after, { type: 'layer', id }, group.id)
    state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '创建文件夹', snapshotLayerTree(before), snapshotLayerTree(after)))
    return group.id
  },
  removeGroup: (id, removeChildren) => {
    const state = get()
    if (!removeChildren) {
      const after = dissolveLayerGroup(state.project, id)
      state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '解散文件夹', snapshotLayerTree(state.project), snapshotLayerTree(after)))
      return
    }
    const after = state.getSnapshot(), groups = new Set([id])
    if (!after.project.groups.some(group => group.id === id)) return
    for (let changed = true; changed;) {
      changed = false
      for (const group of after.project.groups) if (group.parentId && groups.has(group.parentId) && !groups.has(group.id)) { groups.add(group.id); changed = true }
    }
    if ([...groups].some(groupId => getLayerGroupState(after.project, groupId).locked)) throw new Error('请先解锁文件夹及其后代')
    const removedLayers = new Set(after.project.groups.filter(group => groups.has(group.id)).flatMap(group => group.layerIds))
    const removedDatasets = new Set(after.project.layers.filter(layer => removedLayers.has(layer.id)).map(layer => layer.datasetId))
    after.project.layers = after.project.layers.filter(layer => !removedLayers.has(layer.id))
    after.project.groups = after.project.groups.filter(group => !groups.has(group.id))
    const retainedDatasets = new Set(after.project.layers.map(layer => layer.datasetId))
    after.project.datasets = after.project.datasets.filter(dataset => !removedDatasets.has(dataset.id) || retainedDatasets.has(dataset.id))
    for (const datasetId of removedDatasets) if (!retainedDatasets.has(datasetId)) delete after.featuresByDataset[datasetId]
    after.project = normalizeLayerTree(after.project)
    state.applySnapshotAsEdit(after, '删除文件夹及其内容')
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

  relocateLayer: (id, target) => {
    const state = get(), after = moveLayerTreeEntry(state.project, { type: 'layer', id }, target.kind === 'group' ? target.groupId : undefined, target.index)
    state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '移动图层', snapshotLayerTree(state.project), snapshotLayerTree(after)))
  },
  addLayersToGroup: (groupId, ids) => {
    const state = get()
    let after = state.project
    for (const id of ids) after = moveLayerTreeEntry(after, { type: 'layer', id }, groupId)
    state.executeEditCommand(new SetLayerTreeCommand(createId('cmd'), '移动图层到文件夹', snapshotLayerTree(state.project), snapshotLayerTree(after)))
  },
  _resetAttributeHistoryForTests: () => {
    editHistory.clear()
  },

  _resetProjectHistoryForTests: () => {
    editHistory.clear()
  }

}})
