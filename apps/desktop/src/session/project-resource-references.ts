import { cloneValue, type ProjectSnapshot } from '@desktop-webgis/project'
import { isRuntimeResourceUrl, type ResourceReference } from '@desktop-webgis/cesium-scene-schema'
import { referenceForProjectFile, resolveResourceReference } from '@/platform/resource-paths'

function mapReferences(snapshot: ProjectSnapshot, map: (reference: ResourceReference) => ResourceReference): ProjectSnapshot {
  const result = cloneValue(snapshot)
  if (result.project.content.kind === 'map2d') for (const dataset of result.project.content.datasets) {
    if (dataset.kind === 'vector' && dataset.storage) {
      const reference = map(dataset.storage.reference)
      if (reference.kind === 'url') throw new Error('数据保存目标需要本地文件引用')
      dataset.storage.reference = reference
    }
  }
  for (const asset of Object.values(result.project.content.scene?.assets ?? {})) {
    if (asset.url && isRuntimeResourceUrl(asset.url)) throw new Error('临时资源授权 URL 不能写入项目文件')
    if (asset.reference) asset.reference = map(asset.reference)
  }
  return result
}

/** Working references use stable absolute paths so Save As cannot change their meaning. */
export function resolveProjectResourceReferences(snapshot: ProjectSnapshot, projectPath: string): ProjectSnapshot {
  return mapReferences(snapshot, reference => resolveResourceReference(reference, projectPath))
}

/** Rebase only the detached disk snapshot; editing state and history remain unchanged. */
export function prepareProjectResourceReferences(snapshot: ProjectSnapshot, sourcePath: string | null, targetPath: string): ProjectSnapshot {
  return mapReferences(snapshot, reference => referenceForProjectFile(reference, sourcePath, targetPath))
}
