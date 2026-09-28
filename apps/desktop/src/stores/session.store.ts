import { create } from 'zustand'

type InspectorTab = 'layer' | 'feature'

interface AttributeTableState {
  searchQuery: string
  currentPage: number
  scrollTop: number
}

interface LayerSession {
  attributeTable?: AttributeTableState
  inspector?: {
    activeTab: InspectorTab
  }
}

interface SessionState {
  sessions: Record<string, LayerSession>
  getLayerSession(layerId: string): LayerSession
  setAttributeTableState(layerId: string, updates: Partial<AttributeTableState>): void
  setInspectorTab(layerId: string, tab: InspectorTab): void
  clearLayerSession(layerId: string): void
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
  clearLayerSession: (layerId) =>
    set((prev) => {
      const { [layerId]: _removed, ...rest } = prev.sessions
      return { sessions: rest }
    })
}))
