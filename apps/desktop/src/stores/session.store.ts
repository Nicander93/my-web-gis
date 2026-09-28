import { create } from 'zustand'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { cloneValue } from '@desktop-webgis/gis-core'

type InspectorTab = 'layer' | 'feature' | 'style' | 'label'

interface AttributeTableState {
  searchQuery: string
  currentPage: number
  scrollTop: number
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
  attributeTable?: AttributeTableState
  inspector?: {
    activeTab: InspectorTab
  }
  styleDraft?: StyleDraftState
}

interface SessionState {
  sessions: Record<string, LayerSession>
  getLayerSession(layerId: string): LayerSession
  setAttributeTableState(layerId: string, updates: Partial<AttributeTableState>): void
  setInspectorTab(layerId: string, tab: InspectorTab): void
  ensureStyleDraft(layerId: string, applied: LayerStyle): StyleDraftState
  setStyleDraft(layerId: string, draft: StyleDraftState): void
  patchStyleDraft(layerId: string, patch: Partial<StyleDraftState>): void
  clearLayerSession(layerId: string): void
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
  getLayerSession: (layerId) => get().sessions[layerId] || {},
  setAttributeTableState: (layerId, updates) =>
    set((prev) => {
      const existing = prev.sessions[layerId]
      return {
        sessions: {
          ...prev.sessions,
          [layerId]: {
            ...existing,
            attributeTable: {
              searchQuery: updates.searchQuery ?? existing?.attributeTable?.searchQuery ?? '',
              currentPage: updates.currentPage ?? existing?.attributeTable?.currentPage ?? 1,
              scrollTop: updates.scrollTop ?? existing?.attributeTable?.scrollTop ?? 0
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
    })
}))

export type { InspectorTab }
