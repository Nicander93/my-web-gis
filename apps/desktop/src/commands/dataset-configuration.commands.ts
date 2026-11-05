import { assertNoSecretValues, cloneValue, requireMapContent, type ServiceSource } from '@desktop-webgis/project'
import { commitProjectConfiguration, useProjectStore } from '@/project/project.store'

/** 服务加载得到的信息只更新序列化后的定义，不产生用户编辑，也不碰行数据。 */
export const datasetConfigurationCommands = {
  patchWfsServiceSource(datasetId: string, patch: Partial<Extract<ServiceSource, { type: 'wfs' }>>): void {
    const { project } = useProjectStore.getState(), content = requireMapContent(project)
    const dataset = content.datasets.find(item => item.id === datasetId)
    if (!dataset || dataset.kind !== 'wfs') return
    const source = { ...dataset.source, ...cloneValue(patch), type: 'wfs' as const }
    if (JSON.stringify(source) === JSON.stringify(dataset.source)) return
    const next = { ...project, content: { ...content,
      datasets: content.datasets.map(item => item === dataset ? { ...dataset, source } : item) } }
    assertNoSecretValues({ project: next, featuresByDataset: {} })
    commitProjectConfiguration(next)
  }
}
