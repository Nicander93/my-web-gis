import { finishStyleInteraction } from './style-interaction'

/** Compatibility entry for scene replacement; all style values already belong to Project. */
export async function resolveSceneDrafts(): Promise<boolean> {
  finishStyleInteraction()
  return true
}
