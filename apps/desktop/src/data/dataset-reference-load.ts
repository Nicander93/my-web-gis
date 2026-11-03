import { assertProjectSnapshotWorkspace, cloneValue, readManagedDatasetFile, type ProjectSnapshot } from '@desktop-webgis/project'
import { readTextFile } from '@/platform/files'
import { normalizeLocalResourcePath } from '@/platform/resource-paths'

/** Existing embedded snapshots remain authoritative until configuration/data save migration is released. */
export function hasUnloadedDatasetReferences(snapshot: ProjectSnapshot): boolean {
  return snapshot.project.content.kind === 'map2d' && snapshot.project.content.datasets.some(dataset =>
    dataset.kind === 'vector' && !!dataset.storage && !Object.hasOwn(snapshot.featuresByDataset, dataset.id))
}

/** Stage every referenced source before publishing a project; any failure leaves the current workspace untouched. */
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
