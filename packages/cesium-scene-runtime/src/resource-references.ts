import type { CityScene, ResourceReference } from '@desktop-webgis/cesium-scene-schema'

export type ResourceReferenceResolver = (reference: ResourceReference, signal?: AbortSignal) => Promise<string>

/** Resolve a detached rendering copy; authorization URLs never enter the source document. */
export async function resolveSceneResourceReferences(scene: CityScene, resolve?: ResourceReferenceResolver, signal?: AbortSignal): Promise<CityScene> {
  const result = structuredClone(scene)
  for (const asset of Object.values(result.assets)) {
    signal?.throwIfAborted()
    if (!asset.reference || asset.data) continue
    if (!resolve) {
      if (asset.reference.kind !== 'url') throw new Error('本地资源引用需要宿主提供解析器')
      asset.url = asset.reference.url
    } else asset.url = await resolve(asset.reference, signal)
    signal?.throwIfAborted()
  }
  return result
}
