import type { Viewer } from 'cesium'

interface Interaction { cancel(): void }
const interactions = new WeakMap<Viewer, Interaction>()

/** Drawing and vertex editing share one input owner per viewer. */
export function claimInteraction(viewer: Viewer, interaction: Interaction): void {
  interactions.get(viewer)?.cancel()
  interactions.set(viewer, interaction)
}
export function releaseInteraction(viewer: Viewer, interaction: Interaction): void {
  if (interactions.get(viewer) === interaction) interactions.delete(viewer)
}
