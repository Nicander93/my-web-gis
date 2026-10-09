import { afterEach, expect, it, vi } from 'vitest'
import { useSessionStore } from '@/stores/session.store'
import { registerSceneDraftGuard, resolveSceneDrafts } from './scene-draft-guard'

afterEach(() => { registerSceneDraftGuard(null); useSessionStore.setState({ sessions: {} }) })

it('does not request a decision without dirty drafts and preserves drafts when cancelled or UI is absent', async () => {
  useSessionStore.setState({ sessions: {} })
  const guard = vi.fn(async () => false)
  registerSceneDraftGuard(guard)
  expect(await resolveSceneDrafts()).toBe(true)
  expect(guard).not.toHaveBeenCalled()
  useSessionStore.getState().setStyleDraft('layer', { style: { mode: 'single', symbol: { type: 'circle', radius: 4 } }, dirty: true, classCount: 5, colorRampId: 'BlueRed' })
  const before = structuredClone(useSessionStore.getState().sessions)
  expect(await resolveSceneDrafts()).toBe(false)
  expect(useSessionStore.getState().sessions).toEqual(before)
  registerSceneDraftGuard(null)
  expect(await resolveSceneDrafts()).toBe(false)
  registerSceneDraftGuard(async () => true)
  expect(await resolveSceneDrafts()).toBe(true)
})
