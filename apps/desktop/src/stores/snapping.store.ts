import { create } from 'zustand'
import { DEFAULT_SNAPPING, type SnappingOptions } from '@desktop-webgis/ol-runtime'

interface SnappingState {
  options: SnappingOptions
  snapped: boolean
  update(options: Partial<SnappingOptions>): void
  setSnapped(snapped: boolean): void
}

/** 编辑偏好属于会话状态，与项目数据和撤销历史分开。 */
export const useSnappingStore = create<SnappingState>((set) => ({
  options: { ...DEFAULT_SNAPPING },
  snapped: false,
  update: patch => set(state => {
    const options = { ...state.options, ...patch }
    if (!Number.isFinite(options.pixelTolerance)) return state
    options.pixelTolerance = Math.max(1, Math.min(30, Math.round(options.pixelTolerance)))
    if (!options.vertex && !options.edge) options.enabled = false
    return { options, snapped: false }
  }),
  setSnapped: snapped => set(state => state.snapped === snapped ? state : { snapped })
}))
