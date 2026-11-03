import { projectSession } from '@/session/project-session'
import { projectEdits } from '@/session/project-edits'
import { expect, it } from 'vitest'
import { usePreferencesStore } from './preferences.store'
import { useProjectStore } from '@/session/project.store'

it('keeps appearance changes and resets outside project data, dirty state and edit history', () => {
  const before = projectSession.getSnapshot()
  const dirty = useProjectStore.getState().dirty
  const undo = projectEdits.canUndo()
  usePreferencesStore.getState().update({ theme: 'dark', density: 'standard', fontSize: 14 })
  expect(projectSession.getSnapshot()).toEqual(before)
  expect(useProjectStore.getState().dirty).toBe(dirty)
  expect(projectEdits.canUndo()).toBe(undo)
  usePreferencesStore.getState().reset()
  expect(usePreferencesStore.getState()).toMatchObject({ theme: 'light', density: 'compact', fontSize: 12 })
})
