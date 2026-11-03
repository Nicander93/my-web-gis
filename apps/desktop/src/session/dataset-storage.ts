import { ApplyProjectConfigurationCommand, capabilitiesForDataset, cloneValue, createId, isDatasetLocked,
  readManagedDatasetFile, sameValue, stringifyManagedDatasetFile, type VectorDataset } from '@desktop-webgis/project'
import { useProjectStore } from '@/session/project.store'
import { featureData } from '@/data/feature-data'
import { createTextFile, readTextFile } from '@/platform/files'
import { normalizeLocalResourcePath } from '@/platform/resource-paths'
import { projectEdits } from './project-edits'
import { commitDatasetEdits } from './data-save'
import { createGeoJsonDataWriter } from '@/data/geojson-data-writer'

function currentDataset(datasetId: string): VectorDataset {
  const project = useProjectStore.getState().project
  if (project.content.kind !== 'map2d') throw new Error('当前工程不是二维工作区')
  const dataset = project.content.datasets.find(dataset => dataset.id === datasetId)
  if (!dataset || dataset.kind !== 'vector' || !capabilitiesForDataset(dataset).editGeometry) throw new Error('此数据源不支持本地数据保存')
  if (isDatasetLocked(project, datasetId)) throw new Error('引用该数据集的图层或文件夹已锁定')
  return dataset
}

function captureSource(datasetId: string) {
  featureData.assertIdle()
  const dataset = currentDataset(datasetId), identity = featureData.getSessionIdentity(datasetId), revision = featureData.getSourceRevision(datasetId)
  if (!identity || revision === undefined) throw new Error('数据源尚未加载')
  const epoch = useProjectStore.getState().projectEpoch, source = cloneValue(dataset.source), storage = cloneValue(dataset.storage), crs = dataset.sourceCrs
  return {
    dataset,
    assertCurrent() {
      featureData.assertIdle()
      const current = currentDataset(datasetId)
      if (useProjectStore.getState().projectEpoch !== epoch || featureData.getSessionIdentity(datasetId) !== identity || featureData.getSourceRevision(datasetId) !== revision ||
        !sameValue(current.source, source) || !sameValue(current.storage, storage) || current.sourceCrs !== crs) throw new Error('数据源或保存目标已变化，请重新操作')
    }
  }
}

async function originalText(datasetId: string): Promise<string> {
  return stringifyManagedDatasetFile(await featureData.readSource(datasetId), await featureData.readSourceFields(datasetId))
}

function bind(datasetId: string, path: string): void {
  const before = useProjectStore.getState().project
  if (before.content.kind !== 'map2d') throw new Error('当前工程不是二维工作区')
  const after = { ...before, content: { ...before.content, datasets: before.content.datasets.map(dataset => dataset.id === datasetId
    ? { ...dataset, storage: { type: 'managed-geojson' as const, reference: { kind: 'absolute' as const, path } } } : dataset) } }
  projectEdits.execute(new ApplyProjectConfigurationCommand(createId('bind'), '绑定数据文件', before, after))
}

/** Materialize original Provider data, then bind configuration; pending edits remain pending. */
export async function createDatasetStorage(datasetId: string, destination: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const path = normalizeLocalResourcePath(destination), source = captureSource(datasetId), content = await originalText(datasetId)
  signal?.throwIfAborted(); source.assertCurrent()
  await createTextFile(path, content)
  try {
    signal?.throwIfAborted(); source.assertCurrent(); bind(datasetId, path)
  } catch (error) {
    throw new Error(`数据文件已创建但尚未绑定，请保留该文件并重新绑定：${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Adopt an existing managed file only when its data matches the current original Provider. */
export async function bindExistingDatasetStorage(datasetId: string, destination: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const path = normalizeLocalResourcePath(destination), source = captureSource(datasetId)
  const text = await readTextFile(path), original = await originalText(datasetId)
  signal?.throwIfAborted(); source.assertCurrent()
  if (!sameValue(readManagedDatasetFile(text), readManagedDatasetFile(original))) throw new Error('目标文件与当前原始数据不一致，不能直接绑定')
  bind(datasetId, path)
}

/** Resolve the chosen target from configuration; successful data save does not change that configuration. */
export async function saveBoundDataset(datasetId: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  const source = captureSource(datasetId), storage = source.dataset.storage
  if (!storage || storage.reference.kind !== 'absolute') throw new Error('请先绑定并解析本地数据保存目标')
  const path = normalizeLocalResourcePath(storage.reference.path), text = await readTextFile(path), original = await originalText(datasetId)
  signal?.throwIfAborted(); source.assertCurrent()
  if (!sameValue(readManagedDatasetFile(text), readManagedDatasetFile(original))) throw new Error('数据文件与原始源不一致，可能已被外部修改，请重新载入')
  return commitDatasetEdits(datasetId, createGeoJsonDataWriter(path, text), signal)
}
