import { applyFieldFilter, requireMapContent } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { featureData } from '@/data/feature-data'

/** Current synchronous data view; provider queries will replace these full-row reads. */
export function getLayerFeatures(layerId: string) {
  const layer = requireMapContent(useProjectStore.getState().project).layers.find(item => item.id === layerId)
  return layer ? featureData.readSnapshot()[layer.datasetId] ?? [] : []
}

export function getFilteredFeatures(layerId: string) {
  const layer = requireMapContent(useProjectStore.getState().project).layers.find(item => item.id === layerId)
  return layer ? applyFieldFilter(featureData.readSnapshot()[layer.datasetId] ?? [], layer.filter) : []
}
