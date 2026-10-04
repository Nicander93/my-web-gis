import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type CityCategory = 'scene' | 'data' | 'edit' | 'effects' | 'view'
interface CityLayoutState {
  category: CityCategory
  expanded: boolean
  setCategory(category: CityCategory): void
  toggleExpanded(): void
}

/** Ribbon preferences are local layout state, independent of saved projects. */
export const useCityLayoutStore = create<CityLayoutState>()(persist(set => ({
  category: 'data', expanded: true,
  setCategory: category => set({ category, expanded: true }),
  toggleExpanded: () => set(state => ({ expanded: !state.expanded }))
}), { name: 'desktop-webgis.city-ribbon', partialize: ({ category, expanded }) => ({ category, expanded }) }))
