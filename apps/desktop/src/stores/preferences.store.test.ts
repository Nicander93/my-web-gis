import { expect, it } from 'vitest'
import { usePreferencesStore } from './preferences.store'
import { useProjectStore } from './project.store'

it('keeps appearance changes and resets outside project data, dirty state and edit history', () => {
  const before = useProjectStore.getState().getSnapshot()
  const dirty = useProjectStore.getState().dirty
  const undo = useProjectStore.getState().canUndoEdit()
  usePreferencesStore.getState().update({ theme: 'dark', density: 'standard', fontSize: 14 })
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  expect(useProjectStore.getState().dirty).toBe(dirty)
  expect(useProjectStore.getState().canUndoEdit()).toBe(undo)
  usePreferencesStore.getState().reset()
  expect(usePreferencesStore.getState()).toMatchObject({ theme: 'light', density: 'compact', fontSize: 12 })
})
