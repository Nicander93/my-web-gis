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
  // 在已经打开的窗口里切换页签时，也要把它提到重叠面板之上。
  useDockingStore.getState().activate('bottom')
}
