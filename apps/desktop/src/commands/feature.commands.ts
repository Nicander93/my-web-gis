import { cloneValue, createId, isDatasetLocked, requireMapContent, UpdatePropertiesCommand, type GisFeature } from '@desktop-webgis/project'
import { featureData } from '@/project/datasets/feature-data'
import { projectEdits } from '@/project/project-edits'
import { useProjectStore } from '@/project/project.store'

export const featureCommands = {
  /** 服务刷新只是替换一份有界快照，并不会让远端数据源变成可写。 */
  replaceDatasetFeatures(datasetId: string, features: GisFeature[]): void {
    const state = useProjectStore.getState()
    if (state.project.content.kind !== 'map2d' || !state.project.content.datasets.some(dataset => dataset.id === datasetId)) throw new Error('数据集不属于当前二维工程')
    featureData.transaction(() => { featureData.setAll(datasetId, features) })
  },
  updateProperties(layerId: string, featureId: string, nextProperties: Record<string, unknown>): boolean {
    const project = useProjectStore.getState().project, content = requireMapContent(project)
    const layer = content.layers.find(item => item.id === layerId)
    if (!layer || isDatasetLocked(project, layer.datasetId) || content.datasets.find(dataset => dataset.id === layer.datasetId)?.kind !== 'vector') return false
    const feature = featureData.getById(layer.datasetId, featureId)
    if (!feature) return false
    if (JSON.stringify(feature.properties) === JSON.stringify(nextProperties)) return true
    return projectEdits.execute(new UpdatePropertiesCommand(createId('cmd'), layer.datasetId, featureId, cloneValue(feature.properties), cloneValue(nextProperties)))
  }
}
