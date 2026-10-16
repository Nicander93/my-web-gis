import type { CesiumScene, ResourceReference } from '@desktop-webgis/cesium-scene-schema'
import { getCesiumSceneNodeState } from '@desktop-webgis/cesium-scene-schema'
import { localProjectDirectory, normalizeLocalResourcePath, resolveResourceReference, resourcePathWithinDirectory } from './resource-paths'

export interface ResourceRelocation { assetId: string; before: ResourceReference; after: ResourceReference }

/** Keeps dependent GLTF/Tileset files together by preserving paths below the old root. */
export function planResourceRelocation(scene: CesiumScene, assetId: string, target: string, directory: boolean, projectPath: string | null): ResourceRelocation[] {
  const selected = scene.assets[assetId]?.reference
  if (!selected) throw new Error('请选择使用本地文件的资源')
  const source = resolveResourceReference(selected, projectPath)
  if (source.kind !== 'absolute') throw new Error('网络资源不需要本地重定位')
  const normalized = normalizeLocalResourcePath(target)
  const root = localProjectDirectory(source.path)
  const changes: ResourceRelocation[] = []
  for (const [id, asset] of Object.entries(scene.assets)) {
    if (!asset.reference) continue
    const resolved = resolveResourceReference(asset.reference, projectPath)
    if (resolved.kind !== 'absolute') continue
    const relative = resourcePathWithinDirectory(resolved.path, root)
    const path = directory ? relative === null ? null : normalizeLocalResourcePath(`${normalized}/${relative}`) : id === assetId ? normalized : null
    if (path && path !== resolved.path) changes.push({ assetId: id, before: structuredClone(asset.reference), after: { kind: 'absolute', path } })
  }
  return changes
}

export function applyResourceRelocation(scene: CesiumScene, changes: ResourceRelocation[]): CesiumScene {
  if (!changes.length) throw new Error('资源位置未变化')
  const result = structuredClone(scene)
  for (const change of changes) {
    if (scene.nodes.some(node => 'asset' in node && node.asset === change.assetId && getCesiumSceneNodeState(scene, node).locked)) throw new Error('引用此资源的对象或文件夹已锁定，请先解锁')
    const asset = result.assets[change.assetId]
    if (!asset || JSON.stringify(asset.reference) !== JSON.stringify(change.before)) throw new Error('资源引用已变化，请重新定位')
    asset.reference = structuredClone(change.after)
    delete asset.url
  }
  return result
}
