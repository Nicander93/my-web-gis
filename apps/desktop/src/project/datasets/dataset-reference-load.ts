import { assertProjectSnapshotWorkspace, cloneValue, readManagedDatasetFile, type ProjectSnapshot } from '@desktop-webgis/project'
import { readTextFile } from '@/platform/files'
import { normalizeLocalResourcePath } from '@/platform/resource-paths'

/** 在配置和数据的保存迁移完成之前，已有的内嵌快照仍然以原样为准。 */
export function hasUnloadedDatasetReferences(snapshot: ProjectSnapshot): boolean {
  return snapshot.project.content.kind === 'map2d' && snapshot.project.content.datasets.some(dataset =>
    dataset.kind === 'vector' && !!dataset.storage && !Object.hasOwn(snapshot.featuresByDataset, dataset.id))
}

/** 发布项目之前先把所有被引用的数据源准备好；任何一步失败都不会改动当前工作区。 */
export async function loadDatasetReferences(snapshot: ProjectSnapshot, signal?: AbortSignal): Promise<ProjectSnapshot> {
  signal?.throwIfAborted(); assertProjectSnapshotWorkspace(snapshot)
  const result = cloneValue(snapshot)
  if (result.project.content.kind !== 'map2d') return result
  await Promise.all(result.project.content.datasets.map(async dataset => {
    if (dataset.kind !== 'vector' || !dataset.storage || Object.hasOwn(result.featuresByDataset, dataset.id)) return
    const reference = dataset.storage.reference
    if (reference.kind !== 'absolute') throw new Error('数据保存目标的相对引用尚未解析')
    const text = await readTextFile(normalizeLocalResourcePath(reference.path))
    signal?.throwIfAborted()
    const loaded = readManagedDatasetFile(text)
    result.featuresByDataset[dataset.id] = loaded.features
    if (loaded.fields === undefined) delete dataset.fields
    else dataset.fields = loaded.fields
  }))
  signal?.throwIfAborted()
  return result
}
