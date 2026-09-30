import { create } from 'zustand'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { cloneValue } from '@desktop-webgis/gis-core'

type InspectorTab = 'layer' | 'feature' | 'style' | 'label'

interface AttributeTableState {
  /** Session-only table text search (表内搜索); does not change map filter/selection. */
  searchQuery: string
  currentPage: number
  scrollTop: number
  /** View mode: show only S. Does not modify F. */
  selectedOnly: boolean
  /** Session sort specs (stable Feature ID tie-break in gis-core). */
  sortField: string | null
  sortDirection: 'asc' | 'desc'
  /** Field currently shown in stats panel. */
  statsField: string | null
}

/** 样式草稿：改草稿不改项目，应用后才写入图层配置 */
export interface StyleDraftState {
  style: LayerStyle
  dirty: boolean
  /** 分级/分类参数（重新分类才消费） */
  classCount: number
  colorRampId: string
}

interface LayerSession {
  /** Session-only loading indicator for LayerPanel. */
  loading?: boolean
  attributeTable?: AttributeTableState
  inspector?: {
    activeTab: InspectorTab
  }
  styleDraft?: StyleDraftState
}

/** Map view extent in WGS84 [west,south,east,north]; updated from OlMapRuntime moveend when mounted. */
export type MapViewExtentWgs84 = [number, number, number, number]

const DEFAULT_MAP_VIEW_EXTENT: MapViewExtentWgs84 = [73, 18, 135, 54]

interface SessionState {
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
  setAttributeTableState(layerId: string, updates: Partial<AttributeTableState>): void
  setInspectorTab(layerId: string, tab: InspectorTab): void
  ensureStyleDraft(layerId: string, applied: LayerStyle): StyleDraftState
  setStyleDraft(layerId: string, draft: StyleDraftState): void
  patchStyleDraft(layerId: string, patch: Partial<StyleDraftState>): void
  clearLayerSession(layerId: string): void
  setLayerLoading(layerId: string, loading: boolean): void
}

const DEFAULT_CLASS_COUNT = 5
const DEFAULT_RAMP = 'BlueRed'

function createDraftFromApplied(applied: LayerStyle): StyleDraftState {
  return {
    style: cloneValue(applied),
    dirty: false,
    classCount: applied.mode === 'graduated' ? Math.max(applied.breaks.length, 1) : DEFAULT_CLASS_COUNT,
    colorRampId: DEFAULT_RAMP
  }
}

export const useSessionStore = create<SessionState>((set, get) => ({
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
              searchQuery: updates.searchQuery ?? current?.searchQuery ?? '',
              currentPage: updates.currentPage ?? current?.currentPage ?? 1,
              scrollTop: updates.scrollTop ?? current?.scrollTop ?? 0,
              selectedOnly: updates.selectedOnly ?? current?.selectedOnly ?? false,
              sortField: updates.sortField !== undefined ? updates.sortField : (current?.sortField ?? null),
              sortDirection: updates.sortDirection ?? current?.sortDirection ?? 'asc',
              statsField: updates.statsField !== undefined ? updates.statsField : (current?.statsField ?? null)
            }
          }
        }
      }
    }),
  setInspectorTab: (layerId, tab) =>
    set((prev) => {
      const existing = prev.sessions[layerId]
      return {
        sessions: {
          ...prev.sessions,
          [layerId]: {
            ...existing,
            inspector: { activeTab: tab }
          }
        }
      }
    }),
  ensureStyleDraft: (layerId, applied) => {
    const existing = get().sessions[layerId]?.styleDraft
    if (existing) return existing
    const draft = createDraftFromApplied(applied)
    set((prev) => ({
      sessions: {
        ...prev.sessions,
        [layerId]: {
          ...prev.sessions[layerId],
          styleDraft: draft
        }
      }
    }))
    return draft
  },
  setStyleDraft: (layerId, draft) =>
    set((prev) => ({
      sessions: {
        ...prev.sessions,
        [layerId]: {
          ...prev.sessions[layerId],
          styleDraft: draft
        }
      }
    })),
  patchStyleDraft: (layerId, patch) =>
    set((prev) => {
      const existing = prev.sessions[layerId]?.styleDraft
      if (!existing) return prev
      return {
        sessions: {
          ...prev.sessions,
          [layerId]: {
            ...prev.sessions[layerId],
            styleDraft: { ...existing, ...patch, dirty: patch.dirty ?? true }
          }
        }
      }
    }),
  clearLayerSession: (layerId) =>
    set((prev) => {
      const { [layerId]: _removed, ...rest } = prev.sessions
      return { sessions: rest }
    }),
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
