import { create } from 'zustand'
import { DEFAULT_SNAPPING, type SnappingOptions } from '@desktop-webgis/ol-runtime'

interface SnappingState {
  options: SnappingOptions
  snapped: boolean
  update(options: Partial<SnappingOptions>): void
  setSnapped(snapped: boolean): void
}

/** Editing preferences are session state, separate from project data and undo history. */
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
