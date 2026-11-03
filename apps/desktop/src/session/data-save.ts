import { capabilitiesForDataset, isDatasetLocked, type PersistFeatureRows } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { featureData } from '@/data/feature-data'
import { projectEdits } from './project-edits'

/** Internal explicit data-save orchestration; configuration saving does not call this entry point. */
export async function commitDatasetEdits(datasetId: string, persist: PersistFeatureRows, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  const project = useProjectStore.getState().project
  if (project.content.kind !== 'map2d') throw new Error('当前工程不是二维工作区')
  const dataset = project.content.datasets.find(dataset => dataset.id === datasetId)
  if (!dataset || !capabilitiesForDataset(dataset).editGeometry) throw new Error('此数据源不支持数据提交')
  if (isDatasetLocked(project, datasetId)) throw new Error('引用该数据集的图层或文件夹已锁定')
  const release = projectEdits.beginDataCommit(datasetId)
  let session: object | undefined
  try {
    session = featureData.beginCommitSession(datasetId)
    const receipt = await featureData.saveDataset(datasetId, persist, signal, session)
    if (!receipt) return false
    projectEdits.clearCommittedRows(receipt)
    return true
  } finally {
    try { release() } finally { if (session) featureData.endCommitSession(session) }
  }
}
