import { defineStore } from 'pinia'

export type SidebarTab = 'project' | 'layers' | 'data'
export type BottomPanelTab = 'table' | 'feature'

export const useUiStore = defineStore('ui', {
  state: () => ({
    activeSidebarTab: 'layers' as SidebarTab,
    sidebarWidth: 240,
    bottomPanelOpen: true,
    bottomPanelHeight: 220,
    bottomPanelTab: 'table' as BottomPanelTab,
    commandPaletteOpen: false,
    addDataDialogOpen: false,
    dialog: null as null | { title: string; message: string; details?: string },
    statusMessage: '就绪'
  }),
  actions: {
    setStatus(message: string): void {
      this.statusMessage = message
    },
    showError(title: string, message: string, details?: string): void {
      this.dialog = { title, message, details }
      this.statusMessage = message
    },
    closeDialog(): void {
      this.dialog = null
    }
  }
})
