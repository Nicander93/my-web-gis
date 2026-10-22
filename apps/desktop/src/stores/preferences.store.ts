import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'
type Density = 'compact' | 'standard'
type UiFontSize = 11 | 12 | 13 | 14

interface Preferences {
  theme: Theme
  density: Density
  fontSize: UiFontSize
}

interface PreferencesState extends Preferences {
  settingsOpen: boolean
  setSettingsOpen(open: boolean): void
  update(updates: Partial<Preferences>): void
  reset(): void
}

const defaults: Preferences = { theme: 'light', density: 'compact', fontSize: 12 }

/** Software preferences belong to the device, never to a GIS project or its history. */
export const usePreferencesStore = create<PreferencesState>()(persist((set) => ({
  ...defaults,
  settingsOpen: false,
  setSettingsOpen: settingsOpen => set({ settingsOpen }),
  update: updates => set(updates),
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
      fontSize: value.fontSize === 11 || value.fontSize === 12 || value.fontSize === 13 || value.fontSize === 14 ? value.fontSize : defaults.fontSize
    }
  }
}))
