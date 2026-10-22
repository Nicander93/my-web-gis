import { getEffectiveLocked, getLayerCartography } from '@desktop-webgis/gis-core'
import { setDrawingLayerProperty } from '@desktop-webgis/ol-style/cartography-operations'
import { useProjectStore } from '@/stores/project.store'

/** Changes one parameter while retaining all sibling expressions, rules and metadata. */
export function updateStandardStyleProperty(epoch: number, layerId: string, drawingId: string, section: 'paint' | 'layout', property: string, value: unknown, transactionId?: string): void {
  const state = useProjectStore.getState()
  if (state.projectEpoch !== epoch) throw new Error('工程已切换，请重新打开样式。')
  if (getEffectiveLocked(state.project, layerId)) throw new Error('图层已锁定。')
  const fragment = getLayerCartography(state.project, layerId)
  if (!fragment) throw new Error('图层已移除。')
  const layers = setDrawingLayerProperty(fragment.styleLayers, drawingId, section, property, value)
  state.setLayerCartography(layerId, layers, transactionId)
}
