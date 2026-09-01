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
    unsavedPrompt: null as null | { name: string },
    statusMessage: '就绪',
    coordinateText: '0.0000, 0.0000',
    scaleText: '1:0',
    sidebarOpen: true,
    inspectorOpen: true,
    theme: (localStorage.getItem('desktop-webgis.theme') ?? 'system') as ThemeMode
  }),
  actions: {
    setStatus(message: string): void {
      this.statusMessage = message
    },
    setPointerInfo(coordinateText: string, scaleText: string): void {
      this.coordinateText = coordinateText
      this.scaleText = scaleText
    },
    openAttributeTable(): void {
      this.bottomPanelOpen = true
      this.bottomPanelTab = 'table'
    },
    toggleAttributeTable(): void {
      this.bottomPanelOpen = !this.bottomPanelOpen
    },
    toggleSidebar(): void {
      this.sidebarOpen = !this.sidebarOpen
    },
    toggleInspector(): void {
      this.inspectorOpen = !this.inspectorOpen
    },
    answerUnsaved(answer: 'save' | 'discard' | 'cancel'): void {
      this.unsavedPrompt = null
      window.dispatchEvent(new CustomEvent('desktop-webgis:unsaved-answer', { detail: answer }))
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
