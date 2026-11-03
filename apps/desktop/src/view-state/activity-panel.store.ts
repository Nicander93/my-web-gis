import { create } from 'zustand'
import { useWorkspaceStore } from './workspace.store'
import { useDockingStore } from './docking.store'

export type ActivityTab = 'attributes' | 'tasks' | 'diagnostics'
export const useActivityPanelStore = create<{
  tab: ActivityTab
  tasksOpen: boolean
  diagnosticsOpen: boolean
  setTab(tab: ActivityTab): void
  setOpen(window: 'tasks' | 'diagnostics', open: boolean): void
}>(set => ({
  tab: 'attributes', tasksOpen: false, diagnosticsOpen: false,
  setTab: tab => set({ tab }),
  setOpen: (window, open) => set(window === 'tasks' ? { tasksOpen: open } : { diagnosticsOpen: open })
}))
export function openActivityPanel(tab: ActivityTab): void {
  useActivityPanelStore.getState().setTab(tab)
  if (tab !== 'attributes') {
    useActivityPanelStore.getState().setOpen(tab, true)
    return
  }
  useWorkspaceStore.getState().setBottomOpen(true)
  // Changing tabs in an already open window must also raise it above overlapping panels.
  useDockingStore.getState().activate('bottom')
}
