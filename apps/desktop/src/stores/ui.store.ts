import { defineStore } from 'pinia'

export type SidebarTab = 'project' | 'layers' | 'data'
export type BottomPanelTab = 'table' | 'feature'
export type ThemeMode = 'light' | 'dark' | 'system'

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
    statusMessage: '就绪',
    theme: (localStorage.getItem('desktop-webgis.theme') ?? 'system') as ThemeMode
  }),
  actions: {
    setStatus(message: string): void {
      this.statusMessage = message
    },
    setTheme(theme: ThemeMode): void {
      this.theme = theme
      localStorage.setItem('desktop-webgis.theme', theme)
      document.documentElement.dataset.theme = theme
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
