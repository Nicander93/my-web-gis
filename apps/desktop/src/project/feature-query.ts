import { applyFieldFilter, requireMapContent } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { featureData } from '@/project/datasets/feature-data'

/** 当前的同步数据视图；将来由 Provider 查询替代这些整行读取。 */
export function getLayerFeatures(layerId: string) {
  const layer = requireMapContent(useProjectStore.getState().project).layers.find(item => item.id === layerId)
  return layer ? featureData.readSnapshot()[layer.datasetId] ?? [] : []
}

export function getFilteredFeatures(layerId: string) {
  const layer = requireMapContent(useProjectStore.getState().project).layers.find(item => item.id === layerId)
  return layer ? applyFieldFilter(featureData.readSnapshot()[layer.datasetId] ?? [], layer.filter) : []
}
