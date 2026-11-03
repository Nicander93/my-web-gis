import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'
type Density = 'compact' | 'standard'
export const MIN_UI_FONT_SIZE = 8
export const MAX_UI_FONT_SIZE = 14

interface Preferences {
  theme: Theme
  density: Density
  fontSize: number
}

interface PreferencesState extends Preferences {
  settingsOpen: boolean
  setSettingsOpen(open: boolean): void
  update(updates: Partial<Preferences>): void
  reset(): void
}

const defaults: Preferences = { theme: 'light', density: 'compact', fontSize: 12 }

function normalizeFontSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_UI_FONT_SIZE, Math.max(MIN_UI_FONT_SIZE, Math.round(value)))
    : defaults.fontSize
}

/** Software preferences belong to the device, never to a GIS project or its history. */
export const usePreferencesStore = create<PreferencesState>()(persist((set) => ({
  ...defaults,
  settingsOpen: false,
  setSettingsOpen: settingsOpen => set({ settingsOpen }),
  update: updates => set(updates.fontSize === undefined ? updates : { ...updates, fontSize: normalizeFontSize(updates.fontSize) }),
  reset: () => set(defaults)
}), {
  name: 'desktop-webgis.preferences',
  version: 1,
  partialize: ({ theme, density, fontSize }) => ({ theme, density, fontSize }),
  merge: (stored, current) => {
    const value = stored && typeof stored === 'object' ? stored as Partial<Preferences> : {}
    return { ...current,
      theme: value.theme === 'light' || value.theme === 'dark' || value.theme === 'system' ? value.theme : defaults.theme,
      density: value.density === 'standard' ? 'standard' : 'compact',
      fontSize: normalizeFontSize(value.fontSize)
    }
  }
}))
