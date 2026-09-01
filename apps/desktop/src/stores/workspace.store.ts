import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface WorkspaceState {
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
}

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

function getBottomMaxHeight(): number {
  if (typeof window === 'undefined') return 720
  return Math.max(140, Math.floor(window.innerHeight * 0.5))
}

/** 保存 Desktop Workspace 的布局设置，不承载 GIS 业务状态。 */
export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      left: { open: true, width: 260 },
      right: { open: false, width: 300 },
      bottom: { open: false, height: 240 },
      setLeftOpen: (open) => set((state) => ({ left: { ...state.left, open } })),
      setLeftWidth: (width) => set((state) => ({ left: { ...state.left, width: clamp(width, 220, 380) } })),
      setRightOpen: (open) => set((state) => ({ right: { ...state.right, open } })),
      setRightWidth: (width) => set((state) => ({ right: { ...state.right, width: clamp(width, 260, 420) } })),
      setBottomOpen: (open) => set((state) => ({ bottom: { ...state.bottom, open } })),
      setBottomHeight: (height) =>
        set((state) => ({
          bottom: { ...state.bottom, height: clamp(height, 140, getBottomMaxHeight()) }
        })),
      restoreLeft: () => set((state) => ({ left: { ...state.left, open: true, width: 260 } })),
      restoreRight: () => set((state) => ({ right: { ...state.right, open: true, width: 300 } })),
      restoreBottom: () => set((state) => ({ bottom: { ...state.bottom, open: true, height: 240 } })),
      resetLayout: () =>
        set({
          left: { open: true, width: 260 },
          right: { open: false, width: 300 },
          bottom: { open: false, height: 240 }
        })
    }),
    {
      name: 'desktop-webgis.workspace-layout',
      partialize: (state) => ({ left: state.left, right: state.right, bottom: state.bottom })
    }
  )
)
