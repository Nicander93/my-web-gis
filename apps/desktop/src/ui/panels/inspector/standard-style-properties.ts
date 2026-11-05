import { layerConfigurationCommands } from '@/commands/layer-configuration.commands'
import { getEffectiveLocked, getLayerCartography } from '@desktop-webgis/project'
import { setDrawingLayerProperty } from '@desktop-webgis/ol-style/cartography-operations'
import { useProjectStore } from '@/project/project.store'

/** 只改一个参数，同级的其它表达式、规则和元数据都保留。 */
export function updateStandardStyleProperty(epoch: number, layerId: string, drawingId: string, section: 'paint' | 'layout', property: string, value: unknown, transactionId?: string): void {
  const state = useProjectStore.getState()
  if (state.projectEpoch !== epoch) throw new Error('工程已切换，请重新打开样式。')
  if (getEffectiveLocked(state.project, layerId)) throw new Error('图层已锁定。')
  const fragment = getLayerCartography(state.project, layerId)
  if (!fragment) throw new Error('图层已移除。')
  const layers = setDrawingLayerProperty(fragment.styleLayers, drawingId, section, property, value)
  layerConfigurationCommands.setLayerCartography(layerId, layers, transactionId)
}
