import { create } from 'zustand'
import { useWorkspaceStore } from './workspace.store'

export type ActivityTab = 'attributes' | 'tasks' | 'diagnostics'
export const useActivityPanelStore = create<{ tab: ActivityTab; setTab(tab: ActivityTab): void }>(set => ({ tab: 'attributes', setTab: tab => set({ tab }) }))
export function openActivityPanel(tab: ActivityTab): void {
  useActivityPanelStore.getState().setTab(tab)
  useWorkspaceStore.getState().setBottomOpen(true)
}
