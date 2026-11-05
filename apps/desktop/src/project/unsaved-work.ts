import { isTauri } from '@tauri-apps/api/core'
import { useProjectStore } from '@/project/project.store'
import { featureData } from '@/project/datasets/feature-data'
import { requestProjectSave } from './project-save'
import { createDatasetStorage, saveBoundDataset } from './dataset-storage'
import { pickSaveFile } from '@/platform/files'
import { emitCommandStatus } from '@/platform/command-status'

/** 配置有改动，或活动与保留的数据有未提交项时为真。标题栏的未保存标记只看配置。 */
export function hasUnsavedProjectWork(): boolean {
  return useProjectStore.getState().dirty || featureData.getEditState().unsavedCount > 0
}

/**
 * 配置有改动就先保存，再依次提交每个有未提交修改的已绑定数据源。
 * Retained-only pending or unbound pending cannot be acknowledged here — caller must discard or cancel.
 */
export async function requestUnsavedWorkSave(signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  if (useProjectStore.getState().dirty) {
    if (!await requestProjectSave()) return false
  }
  signal?.throwIfAborted()
  const project = useProjectStore.getState().project
  if (project.content.kind === 'map2d') {
    for (const dataset of featureData.getEditState().datasets) {
      if (!dataset.pendingCount) continue
      const definition = project.content.datasets.find(item => item.id === dataset.datasetId)
      if (!definition || definition.kind !== 'vector' || !definition.storage) {
        emitCommandStatus(`数据集 ${dataset.datasetId} 仍有未提交编辑，请先绑定数据文件或放弃修改`)
        return false
      }
      if (!await saveBoundDataset(dataset.datasetId, signal)) return false
      signal?.throwIfAborted()
    }
  }
  if (featureData.getEditState().unsavedCount > 0) {
    emitCommandStatus('仍有未提交的数据编辑（含历史保留源），请先提交、撤销到干净状态或放弃修改')
    return false
  }
  return !hasUnsavedProjectWork()
}

/** 已绑定的数据源原地写入；未绑定的先创建托管文件，再提交待提交的修改。 */
export async function requestDatasetSave(datasetId: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const project = useProjectStore.getState().project
    if (project.content.kind !== 'map2d') throw new Error('当前工程不是二维工作区')
    const dataset = project.content.datasets.find(item => item.id === datasetId)
    if (!dataset || dataset.kind !== 'vector') throw new Error('此数据源不支持本地数据保存')
    if (dataset.storage) return saveBoundDataset(datasetId, signal)
    if (!isTauri()) {
      emitCommandStatus('浏览器不能写入本地数据文件，请在桌面应用中绑定保存目标')
      return false
    }
    const path = await pickSaveFile({
      title: '保存数据',
      defaultPath: `${dataset.name}.geojson`,
      filters: [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }]
    })
    if (!path) return false
    await createDatasetStorage(datasetId, path, signal)
    return saveBoundDataset(datasetId, signal)
  } catch (error) {
    emitCommandStatus(error instanceof Error ? error.message : String(error))
    return false
  }
}
