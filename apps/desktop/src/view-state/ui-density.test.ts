import { afterEach, describe, expect, it } from 'vitest'
import { usePreferencesStore } from './preferences.store'
import { migrateWorkspaceLayout } from './workspace.store'

describe('desktop density preferences', () => {
  afterEach(() => usePreferencesStore.getState().reset())

  it('accepts font sizes down to 8 and clamps invalid input', () => {
    usePreferencesStore.getState().update({ fontSize: 8 })
    expect(usePreferencesStore.getState().fontSize).toBe(8)
    usePreferencesStore.getState().update({ fontSize: 30 })
    expect(usePreferencesStore.getState().fontSize).toBe(14)
    usePreferencesStore.getState().update({ fontSize: Number.NaN })
    expect(usePreferencesStore.getState().fontSize).toBe(12)
  })

  it('changes old defaults without discarding panel visibility or custom dimensions', () => {
    const old = { left: { open: true, width: 260 }, right: { open: true, width: 365 }, bottom: { open: true, height: 280 }, ribbonCategory: 'data', ribbonExpanded: false }
    expect(migrateWorkspaceLayout(old, 1)).toEqual({ ...old, left: { open: true, width: 240 }, bottom: { open: true, height: 220 } })
    expect(migrateWorkspaceLayout({ ...old, bottom: { open: true, height: 350 } }, 1).bottom.height).toBe(350)
  })
})
