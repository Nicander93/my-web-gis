import { createId } from '@desktop-webgis/gis-core'

interface StyleInteraction { layerId: string; property: string; id: string }
let interaction: StyleInteraction | undefined

/** Only the gesture identity is transient; every value already belongs to Project/history. */
export function beginStyleInteraction(layerId: string, property: string): string {
  if (interaction?.layerId !== layerId || interaction.property !== property) interaction = { layerId, property, id: createId('style-gesture') }
  return interaction.id
}

/** Ends coalescing before saving, switching targets, undo or closing an editor. */
export function finishStyleInteraction(layerId?: string): void {
  if (layerId === undefined || interaction?.layerId === layerId) interaction = undefined
}
