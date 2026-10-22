import { migrateLayerStyle, validateCartographyState, type CartographyState } from '@desktop-webgis/ol-style/cartography-model'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import type { SceneDocument } from './document.js'

export const CARTOGRAPHY_EXTENSION = 'org.my-web-gis.cartography'
export const CARTOGRAPHY_EXTENSION_VERSION = 1
export const CARTOGRAPHY_SCENE_EXTENSIONS = { [CARTOGRAPHY_EXTENSION]: [CARTOGRAPHY_EXTENSION_VERSION] } as const

/** Checks drawing ownership against the portable scene's node/resource identities. */
export function validateSceneCartography(document: Pick<SceneDocument, 'extensions' | 'nodes' | 'resources'>): string[] {
  const extension = document.extensions?.[CARTOGRAPHY_EXTENSION]
  if (!extension || extension.version !== CARTOGRAPHY_EXTENSION_VERSION) return []
  const errors = validateCartographyState(extension.data)
  if (extension.required !== true) errors.push('二维制图扩展必须标记 required，避免旧客户端静默丢失样式')
  if (errors.length) return errors
  const state = extension.data as unknown as CartographyState
  const nodes = new Map(document.nodes.filter(node => node.type === 'vector').map(node => [node.id, node]))
  for (const binding of state.bindings) {
    const node = nodes.get(binding.gisLayerId)
    if (!node || node.resource !== binding.datasetId) errors.push(`绑定 ${binding.gisLayerId} 与矢量节点/资源不一致`)
    nodes.delete(binding.gisLayerId)
  }
  if (nodes.size) errors.push(`缺少矢量节点绑定：${[...nodes.keys()].join(', ')}`)
  return errors
}

/** Reads the validated standard document; unknown versions remain unsupported extensions. */
export function getSceneCartography(document: SceneDocument): CartographyState | undefined {
  const extension = document.extensions?.[CARTOGRAPHY_EXTENSION]
  if (!extension || extension.version !== CARTOGRAPHY_EXTENSION_VERSION) return undefined
  const errors = validateSceneCartography(document)
  if (errors.length) throw new Error(`二维制图扩展无效：${errors.join('; ')}`)
  return structuredClone(extension.data) as unknown as CartographyState
}

/** Keeps explicit scene-node edits consistent; external documents still use strict parsing. */
export function reconcileSceneCartography(document: SceneDocument, previous: SceneDocument): SceneDocument {
  const extension = document.extensions?.[CARTOGRAPHY_EXTENSION]
  if (!extension || extension.version !== CARTOGRAPHY_EXTENSION_VERSION) return document
  const errors = validateCartographyState(extension.data)
  if (errors.length) throw new Error(`二维制图扩展无效：${errors.join('; ')}`)
  const state = structuredClone(extension.data) as unknown as CartographyState
  const before = getSceneCartography(previous)
  const nodes = document.nodes.filter(node => node.type === 'vector')
  const removed = new Set(state.bindings.filter(binding => !nodes.some(node => node.id === binding.gisLayerId)).flatMap(binding => binding.styleLayerIds))
  state.bindings = state.bindings.filter(binding => nodes.some(node => node.id === binding.gisLayerId))
  state.styleLayers = state.styleLayers.filter(layer => !removed.has(layer.id))
  for (const node of nodes) {
    const index = state.bindings.findIndex(binding => binding.gisLayerId === node.id)
    const binding = state.bindings[index]
    const oldNode = previous.nodes.find(old => old.id === node.id)
    const previousBinding = before?.bindings.find(binding => binding.gisLayerId === node.id)
    const fragment = (source: CartographyState, ids: readonly string[]) => ids.map(id => source.styleLayers.find(layer => layer.id === id))
    const cacheChanged = oldNode?.type === 'vector' && JSON.stringify(oldNode.style) !== JSON.stringify(node.style)
    const standardUnchanged = before && binding && previousBinding && JSON.stringify(fragment(state, binding.styleLayerIds)) === JSON.stringify(fragment(before, previousBinding.styleLayerIds))
    if (!binding || cacheChanged && standardUnchanged) {
      const migrated = migrateLayerStyle(node.style as unknown as LayerStyle, node.id, node.resource)
      const sourceId = state.bindings.find(binding => binding.datasetId === node.resource)?.styleSourceId ?? migrated.binding.styleSourceId
      const oldIds = new Set(binding?.styleLayerIds ?? [])
      state.styleLayers = state.styleLayers.filter(layer => !oldIds.has(layer.id))
      state.styleLayers.push(...migrated.styleLayers.map(layer => 'source' in layer ? { ...layer, source: sourceId } : layer))
      const replacement = { ...migrated.binding, styleSourceId: sourceId }
      if (index < 0) state.bindings.push(replacement)
      else state.bindings[index] = replacement
    } else if (binding.datasetId !== node.resource) {
      const sourceId = state.bindings.find(binding => binding.datasetId === node.resource)?.styleSourceId
        ?? migrateLayerStyle(node.style as unknown as LayerStyle, node.id, node.resource).binding.styleSourceId
      state.bindings[index] = { ...binding, datasetId: node.resource, styleSourceId: sourceId }
      state.styleLayers = state.styleLayers.map(layer => binding.styleLayerIds.includes(layer.id) && 'source' in layer ? { ...layer, source: sourceId } : layer)
    }
  }
  return { ...document, extensions: { ...document.extensions, [CARTOGRAPHY_EXTENSION]: { ...extension, data: state as unknown as typeof extension.data } } }
}

/** Merges the known extension while remapping portable node/resource and drawing identities. */
export function mergeSceneCartography(target: SceneDocument, incoming: SceneDocument, ids: {
  nodes: Readonly<Record<string, string>>; resources: Readonly<Record<string, string>>
}): NonNullable<SceneDocument['extensions']>[string] | undefined {
  if (!target.extensions?.[CARTOGRAPHY_EXTENSION] && !incoming.extensions?.[CARTOGRAPHY_EXTENSION]) return undefined
  for (const document of [target, incoming]) {
    const extension = document.extensions?.[CARTOGRAPHY_EXTENSION]
    if (extension && extension.version !== CARTOGRAPHY_EXTENSION_VERSION) throw new Error(`不支持合并二维制图扩展版本 ${extension.version}`)
  }
  const stateFor = (document: SceneDocument): CartographyState => {
    const existing = getSceneCartography(document)
    if (existing) return existing
    const fragments = document.nodes.flatMap(node => node.type === 'vector' ? [migrateLayerStyle(node.style as unknown as LayerStyle, node.id, node.resource)] : [])
    return { specVersion: 8, bindings: fragments.map(fragment => fragment.binding), styleLayers: fragments.flatMap(fragment => fragment.styleLayers) }
  }
  const left = stateFor(target), right = stateFor(incoming)
  const allocate = (id: string, used: Set<string>) => {
    let result = id, suffix = 2
    while (used.has(result)) result = `${id}-${suffix++}`
    used.add(result)
    return result
  }
  const usedSources = new Set([...left.bindings, ...right.bindings].map(binding => binding.styleSourceId))
  const usedLayers = new Set([...left.styleLayers, ...right.styleLayers].map(layer => layer.id))
  const occupiedSources = new Set(left.bindings.map(binding => binding.styleSourceId)), occupiedLayers = new Set(left.styleLayers.map(layer => layer.id))
  const sourceIds = new Map(right.bindings.map(binding => [binding.styleSourceId, binding.styleSourceId]))
  for (const id of sourceIds.keys()) if (occupiedSources.has(id)) sourceIds.set(id, allocate(id, usedSources))
  const layerIds = new Map(right.styleLayers.map(layer => [layer.id, occupiedLayers.has(layer.id) ? allocate(layer.id, usedLayers) : layer.id]))
  const state: CartographyState = { specVersion: 8,
    ...((left.assets || right.assets) ? { assets: [...new Map([...(left.assets ?? []), ...(right.assets ?? [])].map(asset => [asset.id, asset])).values()] } : {}),
    bindings: [...left.bindings, ...right.bindings.map(binding => ({ ...binding, gisLayerId: ids.nodes[binding.gisLayerId], datasetId: ids.resources[binding.datasetId],
      styleSourceId: sourceIds.get(binding.styleSourceId)!, styleLayerIds: binding.styleLayerIds.map(id => layerIds.get(id)!) }))],
    styleLayers: [...left.styleLayers, ...right.styleLayers.map(layer => ({ ...layer, id: layerIds.get(layer.id)!, ...('source' in layer ? { source: sourceIds.get(layer.source)! } : {}) }))],
  }
  const errors = validateCartographyState(state)
  if (errors.length) throw new Error(`合并二维制图失败：${errors.join('; ')}`)
  return { version: CARTOGRAPHY_EXTENSION_VERSION, required: true, data: state as unknown as NonNullable<SceneDocument['extensions']>[string]['data'] }
}
