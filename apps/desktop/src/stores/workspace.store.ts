import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface WorkspaceState {
  ribbonCategory: string
  ribbonExpanded: boolean
  setRibbonCategory(category: string): void
  toggleRibbon(): void
  left: {
    open: boolean
    width: number
  }
  right: {
    open: boolean
    width: number
  }
  bottom: {
    open: boolean
    height: number
  }
  focusMode: boolean
  savedLayout: {
    left: { open: boolean; width: number }
    right: { open: boolean; width: number }
    bottom: { open: boolean; height: number }
  } | null
  setLeftOpen(open: boolean): void
  setLeftWidth(width: number): void
  setRightOpen(open: boolean): void
  setRightWidth(width: number): void
  setBottomOpen(open: boolean): void
  setBottomHeight(height: number): void
  restoreLeft(): void
  restoreRight(): void
  restoreBottom(): void
  resetLayout(): void
  enterFocusMode(): void
  exitFocusMode(): void
  constrainPanelSizes(): void
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

function getBottomMaxHeight(): number {
  if (typeof window === 'undefined') return 720
  return Math.max(140, Math.floor(window.innerHeight * 0.5))
}

function getMinMapWidth(): number {
  return 320
}

/** 保存 Desktop Workspace 的布局设置，不承载 GIS 业务状态。 */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      ribbonCategory: 'edit',
      ribbonExpanded: true,
      setRibbonCategory: (ribbonCategory) => set({ ribbonCategory, ribbonExpanded: true }),
      toggleRibbon: () => set(state => ({ ribbonExpanded: !state.ribbonExpanded })),
      left: { open: true, width: 260 },
      right: { open: false, width: 300 },
      bottom: { open: false, height: 240 },
      focusMode: false,
      savedLayout: null,
      setLeftOpen: (open) => set((state) => ({ left: { ...state.left, open } })),
      setLeftWidth: (width) => set((state) => ({ left: { ...state.left, width: clamp(width, 220, 380) } })),
      setRightOpen: (open) => set((state) => ({ right: { ...state.right, open } })),
      setRightWidth: (width) => set((state) => ({ right: { ...state.right, width: clamp(width, 260, 420) } })),
      setBottomOpen: (open) => set((state) => ({ bottom: { ...state.bottom, open } })),
      setBottomHeight: (height) =>
        set((state) => ({
          bottom: { ...state.bottom, height: clamp(height, 140, getBottomMaxHeight()) }
        })),
      restoreLeft: () => set((state) => ({ left: { ...state.left, open: true } })),
      restoreRight: () => set((state) => ({ right: { ...state.right, open: true } })),
      restoreBottom: () => set((state) => ({ bottom: { ...state.bottom, open: true } })),
      resetLayout: () =>
        set({
          left: { open: true, width: 260 },
          right: { open: false, width: 300 },
          bottom: { open: false, height: 240 }
        }),
      enterFocusMode: () => {
        const state = get()
        if (state.focusMode) return
        set({
          savedLayout: {
            left: { ...state.left },
            right: { ...state.right },
            bottom: { ...state.bottom }
          },
          left: { ...state.left, open: false },
          right: { ...state.right, open: false },
          bottom: { ...state.bottom, open: false },
          focusMode: true
        })
      },
      exitFocusMode: () => {
        const state = get()
        if (!state.focusMode || !state.savedLayout) return
        set({
          left: { ...state.savedLayout.left },
          right: { ...state.savedLayout.right },
          bottom: { ...state.savedLayout.bottom },
          savedLayout: null,
          focusMode: false
        })
      },
      constrainPanelSizes: () => {
        const state = get()
        if (typeof window === 'undefined') return

        const minMapWidth = getMinMapWidth()
        const windowWidth = window.innerWidth
        const leftWidth = state.left.open ? state.left.width : 0
        const rightWidth = state.right.open ? state.right.width : 0
        const availableForPanels = windowWidth - minMapWidth

        if (leftWidth + rightWidth > availableForPanels) {
          const ratio = leftWidth / (leftWidth + rightWidth)
          let targetLeftWidth = Math.floor(availableForPanels * ratio)
          let targetRightWidth = availableForPanels - targetLeftWidth

          if (targetLeftWidth < 220) {
            targetLeftWidth = 220
            targetRightWidth = availableForPanels - 220
          } else if (targetRightWidth < 260) {
            targetRightWidth = 260
            targetLeftWidth = availableForPanels - 260
          }

          set({
            left: { ...state.left, width: clamp(targetLeftWidth, 220, 380) },
            right: { ...state.right, width: clamp(targetRightWidth, 260, 420) }
          })
        }

        const maxBottomHeight = getBottomMaxHeight()
        if (state.bottom.height > maxBottomHeight) {
          set({ bottom: { ...state.bottom, height: clamp(maxBottomHeight, 140, maxBottomHeight) } })
        }
      }
    }),
    {
      name: 'desktop-webgis.workspace-layout',
      version: 1,
      migrate: (stored) => ({ left: (stored as Partial<WorkspaceState>).left ?? { open:true, width:260 }, right: { open:false, width:300 }, bottom: { open:false, height:240 }, ribbonCategory:'edit', ribbonExpanded:true }),
      partialize: (state) => ({ left: state.left, right: state.right, bottom: state.bottom, ribbonCategory: state.ribbonCategory, ribbonExpanded: state.ribbonExpanded })
    }
  )
)
