import { assertNoSecretValues, cloneValue, requireMapContent, type ServiceSource } from '@desktop-webgis/project'
import { commitProjectConfiguration, useProjectStore } from '@/session/project.store'

/** Service load facts update the serialized definition without creating a user edit or touching rows. */
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
