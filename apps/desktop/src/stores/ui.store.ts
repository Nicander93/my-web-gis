import { defineStore } from 'pinia'

export type UnsavedChoice = 'cancel' | 'discard' | 'save'

let unsavedResolve: ((choice: UnsavedChoice) => void) | null = null

export type SidebarTab = 'project' | 'layers' | 'data'
export type BottomPanelTab = 'table' | 'feature'

export const useUiStore = defineStore('ui', {
  state: () => ({
    activeSidebarTab: 'layers' as SidebarTab,
    sidebarOpen: true,
    sidebarWidth: 240,
    inspectorOpen: true,
    bottomPanelOpen: true,
    bottomPanelHeight: 220,
    bottomPanelTab: 'table' as BottomPanelTab,
    commandPaletteOpen: false,
    addDataDialogOpen: false,
    dialog: null as null | { title: string; message: string; details?: string },
    unsavedPrompt: null as null | { name: string },
    statusMessage: '就绪',
    coordinateText: '0.0000, 0.0000',
    scaleText: '1:0'
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
    showError(title: string, message: string, details?: string): void {
      this.dialog = { title, message, details }
      this.statusMessage = message
    },
    closeDialog(): void {
      this.dialog = null
    },
    requestUnsaved(name: string): Promise<UnsavedChoice> {
      this.unsavedPrompt = { name }
      return new Promise((resolve) => {
        unsavedResolve = resolve
      })
    },
    answerUnsaved(choice: UnsavedChoice): void {
      this.unsavedPrompt = null
      unsavedResolve?.(choice)
      unsavedResolve = null
    }
  }
})
