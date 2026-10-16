import { create } from 'zustand'
import { useWorkspaceStore } from './workspace.store'
import { useDockingStore } from './docking.store'

export type ActivityTab = 'attributes' | 'tasks' | 'diagnostics'
export const useActivityPanelStore = create<{ tab: ActivityTab; setTab(tab: ActivityTab): void }>(set => ({ tab: 'attributes', setTab: tab => set({ tab }) }))
export function openActivityPanel(tab: ActivityTab): void {
  useActivityPanelStore.getState().setTab(tab)
  useWorkspaceStore.getState().setBottomOpen(true)
  // Changing tabs in an already open window must also raise it above overlapping panels.
  useDockingStore.getState().activate('bottom')
}
