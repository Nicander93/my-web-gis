export const layerFilterEvent = 'desktop-webgis:layer-filter'

/** 打开图层级的过滤，而不是把地图过滤塞进属性表的某个页签里。 */
export function openLayerFilterWindow(layerId: string): void {
  window.dispatchEvent(new CustomEvent(layerFilterEvent, { detail: layerId }))
}
