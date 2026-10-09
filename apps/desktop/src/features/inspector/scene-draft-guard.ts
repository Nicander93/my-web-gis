import { useSessionStore } from '@/stores/session.store'

let guard: (() => Promise<boolean>) | null = null

/** Register the application decision UI; absent UI never silently discards drafts. */
export function registerSceneDraftGuard(callback: (() => Promise<boolean>) | null): void { guard = callback }

export async function resolveSceneDrafts(): Promise<boolean> {
  if (!Object.values(useSessionStore.getState().sessions).some(session => session.styleDraft?.dirty)) return true
  return guard ? guard() : false
}
