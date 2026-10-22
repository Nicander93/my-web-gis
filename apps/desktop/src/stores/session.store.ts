import { create } from 'zustand'
import { cloneValue } from '@desktop-webgis/gis-core'
import type { FieldFilterCondition } from '@desktop-webgis/gis-core'
import { useWorkbenchStore } from './workbench.store'

type InspectorTab = 'layer' | 'feature' | 'style' | 'label'

interface AttributeTableState {
  filterDraft?: FieldFilterCondition[]
  filterOpen: boolean
  statisticsOpen: boolean
  /** Session-only table text search (表内搜索); does not change map filter/selection. */
  searchQuery: string
  currentPage: number
  scrollTop: number
  scrollLeft: number
  /** View mode: show only S. Does not modify F. */
  selectedOnly: boolean
  /** Session sort specs (stable Feature ID tie-break in gis-core). */
  sortField: string | null
  sortDirection: 'asc' | 'desc'
  /** Field currently shown in stats panel. */
  statsField: string | null
  hiddenFields: string[]
  fieldOrder: string[]
  columnWidths: Record<string, number>
}

interface LayerSession {
  /** Session-only loading indicator for LayerPanel. */
  loading?: boolean
  attributeTable?: AttributeTableState
  inspector?: {
    activeTab: InspectorTab
  }
}

/** Map view extent in WGS84 [west,south,east,north]; updated from OlMapRuntime moveend when mounted. */
export type MapViewExtentWgs84 = [number, number, number, number]

const DEFAULT_MAP_VIEW_EXTENT: MapViewExtentWgs84 = [73, 18, 135, 54]

interface SessionState {
  inspectorTab: InspectorTab
  sessions: Record<string, LayerSession>
  /** Live / placeholder map view for WFS bounded load (extentMode=view). */
  mapViewExtentWgs84: MapViewExtentWgs84
  setMapViewExtentWgs84(extent: MapViewExtentWgs84): void
  /** Monotonic token bumped on project switch; WFS loads must match to apply. */
  wfsLoadGeneration: number
  bumpWfsLoadGeneration(): number
  /** Active AbortControllers keyed by layerId for in-flight WFS loads. */
  wfsAbortByLayer: Record<string, AbortController>
  setWfsAbort(layerId: string, controller: AbortController | null): void
  abortWfsLoad(layerId: string): void
  abortAllWfsLoads(): void
  getLayerSession(layerId: string): LayerSession
  setAttributeTableState(
    layerId: string,
    updates: Partial<AttributeTableState>
  ): void
  setInspectorTab(layerId: string, tab: InspectorTab): void
  clearLayerSession(layerId: string): void
  setLayerLoading(layerId: string, loading: boolean): void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  inspectorTab: 'layer',
  sessions: {},
  mapViewExtentWgs84: DEFAULT_MAP_VIEW_EXTENT,
  wfsLoadGeneration: 0,
  wfsAbortByLayer: {},
  setMapViewExtentWgs84: (extent) => set({ mapViewExtentWgs84: extent }),
  bumpWfsLoadGeneration: () => {
    const next = get().wfsLoadGeneration + 1
    // Abort in-flight WFS loads so they cannot write into the new project.
    get().abortAllWfsLoads()
    set({ wfsLoadGeneration: next })
    return next
  },
  setWfsAbort: (layerId, controller) =>
    set((prev) => {
      const next = { ...prev.wfsAbortByLayer }
      if (!controller) delete next[layerId]
      else next[layerId] = controller
      return { wfsAbortByLayer: next }
    }),
  abortWfsLoad: (layerId) => {
    const c = get().wfsAbortByLayer[layerId]
    c?.abort()
    get().setWfsAbort(layerId, null)
  },
  abortAllWfsLoads: () => {
    for (const c of Object.values(get().wfsAbortByLayer)) c.abort()
    set({ wfsAbortByLayer: {} })
  },
  getLayerSession: (layerId) => get().sessions[layerId] || {},
  setAttributeTableState: (layerId, updates) =>
    set((prev) => {
      const existing = prev.sessions[layerId]
      const current = existing?.attributeTable
      return {
        sessions: {
          ...prev.sessions,
          [layerId]: {
            ...existing,
            attributeTable: {
              ...(updates.filterDraft !== undefined ? { filterDraft: cloneValue(updates.filterDraft) }
                : current?.filterDraft ? { filterDraft: current.filterDraft } : {}),
              hiddenFields: updates.hiddenFields ?? current?.hiddenFields ?? [],
              fieldOrder: updates.fieldOrder ?? current?.fieldOrder ?? [],
              columnWidths: updates.columnWidths ?? current?.columnWidths ?? {},
              filterOpen: updates.filterOpen ?? current?.filterOpen ?? false,
              statisticsOpen:
                updates.statisticsOpen ?? current?.statisticsOpen ?? false,
              searchQuery: updates.searchQuery ?? current?.searchQuery ?? '',
              currentPage: updates.currentPage ?? current?.currentPage ?? 1,
              scrollTop: updates.scrollTop ?? current?.scrollTop ?? 0,
              scrollLeft: updates.scrollLeft ?? current?.scrollLeft ?? 0,
              selectedOnly:
                updates.selectedOnly ?? current?.selectedOnly ?? false,
              sortField:
                updates.sortField !== undefined
                  ? updates.sortField
                  : (current?.sortField ?? null),
              sortDirection:
                updates.sortDirection ?? current?.sortDirection ?? 'asc',
              statsField:
                updates.statsField !== undefined
                  ? updates.statsField
                  : (current?.statsField ?? null)
            }
          }
        }
      }
    }),
  setInspectorTab: (layerId, tab) =>
    set((prev) => {
      const existing = prev.sessions[layerId]
      return {
        inspectorTab: tab,
        sessions: {
          ...prev.sessions,
          [layerId]: {
            ...existing,
            inspector: { activeTab: tab }
          }
        }
      }
    }),
  clearLayerSession: (layerId) => {
    useWorkbenchStore.getState().clearLayer(layerId)
    set((prev) => {
      const { [layerId]: _removed, ...rest } = prev.sessions
      return { sessions: rest }
    })
  },
  setLayerLoading: (layerId, loading) =>
    set((prev) => ({
      sessions: {
        ...prev.sessions,
        [layerId]: {
          ...prev.sessions[layerId],
          loading
        }
      }
    }))
}))

export type { InspectorTab }
