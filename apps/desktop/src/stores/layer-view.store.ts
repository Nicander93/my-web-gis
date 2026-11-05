import { create } from 'zustand'
import { cloneValue } from '@desktop-webgis/project'
import type { FieldFilterCondition, SelectionState } from '@desktop-webgis/project'
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
  /** 视图模式：只显示 S，不修改 F。 */
  selectedOnly: boolean
  /** 会话内的排序规则，要素 ID 相同时按项目里的稳定顺序排列。 */
  sortField: string | null
  sortDirection: 'asc' | 'desc'
  /** 统计面板当前展示的字段。 */
  statsField: string | null
  hiddenFields: string[]
  fieldOrder: string[]
  columnWidths: Record<string, number>
}

interface LayerSession {
  /** 图层树专用的会话内加载指示。 */
  loading?: boolean
  attributeTable?: AttributeTableState
  inspector?: {
    activeTab: InspectorTab
  }
}

/** 地图视图范围的 WGS84 表示 [西,南,东,北]；挂载后由 OlMapRuntime 的 moveend 事件更新。 */
export type MapViewExtentWgs84 = [number, number, number, number]

const DEFAULT_MAP_VIEW_EXTENT: MapViewExtentWgs84 = [73, 18, 135, 54]

interface SessionState {
  // 图层与要素选择状态
  selectedLayerId: string | null
  selection: SelectionState
  lastSelectionCountAfterFilter: number | null
  setSelectedLayer(layerId: string | null): void
  /** 接收经过业务校验后的有效要素选择集。 */
  setSelectionState(selection: SelectionState, count?: number | null): void
  resetProjectSelection(): void

  // 单图层会话状态（属性表分页/排序/搜索、检查器当前 Tab、服务加载态）
  inspectorTab: InspectorTab
  sessions: Record<string, LayerSession>
  getLayerSession(layerId: string): LayerSession
  setAttributeTableState(
    layerId: string,
    updates: Partial<AttributeTableState>
  ): void
  setInspectorTab(layerId: string, tab: InspectorTab): void
  clearLayerSession(layerId: string): void
  setLayerLoading(layerId: string, loading: boolean): void

  // 二维地图当前视口范围与 WFS 异步加载控制
  mapViewExtentWgs84: MapViewExtentWgs84
  setMapViewExtentWgs84(extent: MapViewExtentWgs84): void
  /** 切换工程时递增，防止旧工程未完成的 WFS 请求写入新工程。 */
  wfsLoadGeneration: number
  bumpWfsLoadGeneration(): number
  wfsAbortByLayer: Record<string, AbortController>
  setWfsAbort(layerId: string, controller: AbortController | null): void
  abortWfsLoad(layerId: string): void
  abortAllWfsLoads(): void
}

/** 图层视图与瞬态界面状态 Store（关闭或切换工程即可丢弃，不进入工程保存与撤销栈）。 */
export const useLayerViewStore = create<SessionState>((set, get) => ({
  selectedLayerId: null,
  selection: { layerId: null, featureIds: [] },
  lastSelectionCountAfterFilter: null,
  setSelectedLayer: selectedLayerId => set({ selectedLayerId }),
  setSelectionState: (selection, count = selection.featureIds.length) => set({ selection, lastSelectionCountAfterFilter: count }),
  resetProjectSelection: () => set({ selectedLayerId: null, selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: null }),
  inspectorTab: 'layer',
  sessions: {},
  mapViewExtentWgs84: DEFAULT_MAP_VIEW_EXTENT,
  wfsLoadGeneration: 0,
  wfsAbortByLayer: {},
  setMapViewExtentWgs84: (extent) => set({ mapViewExtentWgs84: extent }),
  bumpWfsLoadGeneration: () => {
    const next = get().wfsLoadGeneration + 1
    // 中止正在进行的 WFS 加载，避免它们把数据写进新项目。
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
