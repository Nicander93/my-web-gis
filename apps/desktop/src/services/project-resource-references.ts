import { cloneValue, type ProjectSnapshot } from '@desktop-webgis/gis-core'
import { isRuntimeResourceUrl, type ResourceReference } from '@desktop-webgis/cesium-scene-schema'
import { referenceForProjectFile, resolveResourceReference } from './resource-paths'

function mapReferences(snapshot: ProjectSnapshot, map: (reference: ResourceReference) => ResourceReference): ProjectSnapshot {
  const result = cloneValue(snapshot)
  for (const asset of Object.values(result.project.city?.assets ?? {})) {
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
