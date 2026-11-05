import { finishStyleInteraction } from './style-interaction'

/** 这是场景替换的兼容入口；所有样式值本来就已经属于 Project。 */
export async function resolveSceneDrafts(): Promise<boolean> {
  finishStyleInteraction()
  return true
}
