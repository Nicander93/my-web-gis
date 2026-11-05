import type { Viewer } from 'cesium'

interface Interaction { cancel(): void }
const interactions = new WeakMap<Viewer, Interaction>()

/** 每个 viewer 的绘制和顶点编辑共用一个输入归属者。 */
export function claimInteraction(viewer: Viewer, interaction: Interaction): void {
  interactions.get(viewer)?.cancel()
  interactions.set(viewer, interaction)
}
export function releaseInteraction(viewer: Viewer, interaction: Interaction): void {
  if (interactions.get(viewer) === interaction) interactions.delete(viewer)
}
