import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createDockLayout, parseDockLayout, type DockLayout, type DockPanelId, type WindowPlacement } from '@/app/docking/docking-layout'

interface DockingState {
  layout: DockLayout
  order: DockPanelId[]
  update(id: DockPanelId, placement: WindowPlacement): void
  activate(id: DockPanelId): void
  reset(): void
}

export const useDockingStore = create<DockingState>()(persist((set) => ({
  layout: createDockLayout(),
  order: ['left', 'right', 'bottom'],
  update: (id, placement) => set(state => ({ layout: { ...state.layout, [id]: placement } })),
  activate: id => set(state => state.order.at(-1) === id ? state : { order: [...state.order.filter(item => item !== id), id] }),
  reset: () => set({ layout: createDockLayout(), order: ['left', 'right', 'bottom'] })
}), {
  name: 'desktop-webgis.docking-layout',
  version: 1,
  partialize: state => ({ layout: state.layout }),
  merge: (stored, current) => ({ ...current, layout: parseDockLayout((stored as { layout?: unknown } | null)?.layout) })
}))
