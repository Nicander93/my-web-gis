export const layerFilterEvent = 'desktop-webgis:layer-filter'

/** Opens the layer-level filter without putting map filtering inside an attribute-table tab. */
export function openLayerFilterWindow(layerId: string): void {
  window.dispatchEvent(new CustomEvent(layerFilterEvent, { detail: layerId }))
}
