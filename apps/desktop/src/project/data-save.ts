import { capabilitiesForDataset, isDatasetLocked, type PersistFeatureRows } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { featureData } from '@/project/datasets/feature-data'
import { projectEdits } from './project-edits'

/** 内部显式的数据保存流程；保存配置不会走到这个入口。 */
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
