import { cloneValue, isLegacyStyle, migrateLegacyStyle, layersWithEffectiveVisibility, requireMapContent, type Layer } from '@desktop-webgis/project'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { useProjectStore } from '@/project/project.store'

/** 读取配置不持有状态，也不会把要素行实例化出来。 */
export const layerConfigurationQueries = {
  getMapLayers(): Layer[] {
    const { project } = useProjectStore.getState()
    return project.content.kind === 'map2d' ? layersWithEffectiveVisibility(project) : []
  },
  getNormalizedLayerStyle(layerId: string): LayerStyle | null {
    const layer = requireMapContent(useProjectStore.getState().project).layers.find(item => item.id === layerId)
    if (!layer) return null
    return isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : cloneValue(layer.style)
  }
}
