import { parseSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'

export interface SceneMergeResult {
  document: SceneDocument
  /** Incoming IDs only; unchanged IDs are included for deterministic host repair. */
  ids: { resources: Record<string, string>; nodes: Record<string, string>; views: Record<string, string>; credentials: Record<string, string> }
}

function allocate(incoming: readonly string[], existing: readonly string[]): Record<string, string> {
  // Reserve incoming names too so repairing "a" does not steal an incoming "a-2".
  const used = new Set([...existing, ...incoming])
  const occupied = new Set(existing)
  return Object.fromEntries(incoming.map(id => {
    let next = id, suffix = 2
    if (occupied.has(id)) { while (used.has(next)) next = `${id}-${suffix++}` }
    used.add(next)
    return [id, next]
  }))
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => same(value, right[index]))
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && same((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}

function combine<T>(left: Record<string, T> | undefined, right: Record<string, T> | undefined, field: string): Record<string, T> | undefined {
  if (!left && !right) return undefined
  for (const [key, value] of Object.entries(right ?? {})) {
    if (left && Object.hasOwn(left, key) && !same(left[key], value)) throw new Error(`Cannot merge conflicting ${field}.${key}`)
  }
  return { ...left, ...right }
}

/** Pure all-or-nothing merge; incompatible shared settings require a host decision before retrying. */
export function mergeSceneDocuments(target: SceneDocument, incoming: SceneDocument): SceneMergeResult {
  const document = parseSceneDocument(target), source = parseSceneDocument(incoming)
  const ids = {
    resources: allocate(Object.keys(source.resources), Object.keys(document.resources)),
    nodes: allocate(source.nodes.map(node => node.id), document.nodes.map(node => node.id)),
    views: allocate(Object.keys(source.views), Object.keys(document.views)),
    credentials: allocate(Object.keys(source.credentials ?? {}), Object.keys(document.credentials ?? {}))
  }
  const remapped = Object.values(ids).some(mapping => Object.entries(mapping).some(([before, after]) => before !== after))
  if (remapped && Object.keys(source.extensions ?? {}).length) throw new Error('Extension ID references require an extension merge adapter')
  for (const [id, resource] of Object.entries(source.resources)) {
    if (resource.type === 'provider') resource.credential = ids.credentials[resource.credential]
    if (resource.authentication?.credential) resource.authentication.credential = ids.credentials[resource.authentication.credential]
    Object.defineProperty(document.resources, ids.resources[id], { value: resource, enumerable: true, configurable: true, writable: true })
  }
  document.nodes.push(...source.nodes.map(node => ({ ...node, id: ids.nodes[node.id],
    ...(node.parentId ? { parentId: ids.nodes[node.parentId] } : {}),
    ...('resource' in node ? { resource: ids.resources[node.resource] } : {}) })))
  document.views = { ...document.views, ...Object.fromEntries(Object.entries(source.views).map(([id, view]) => [ids.views[id], view])) }
  if (source.credentials) document.credentials = { ...document.credentials, ...Object.fromEntries(Object.entries(source.credentials).map(([id, credential]) => [ids.credentials[id], credential])) }
  for (const field of ['environment', 'metadata', 'extensions'] as const) {
    const merged = combine(document[field] as Record<string, unknown> | undefined, source[field] as Record<string, unknown> | undefined, field)
    if (merged) Object.assign(document, { [field]: merged })
  }
  if (source.presentation?.chapters) source.presentation.chapters = source.presentation.chapters.map(chapter => ({ ...chapter,
    ...(chapter.visibleLayers ? { visibleLayers: chapter.visibleLayers.map(id => ids.nodes[id]) } : {}) }))
  for (const field of ['widgets', 'theme', 'presentation'] as const) {
    if (source[field] === undefined) continue
    if (document[field] !== undefined && !same(document[field], source[field])) throw new Error(`Cannot merge conflicting ${field}`)
    Object.assign(document, { [field]: source[field] })
  }
  return { document: parseSceneDocument(document), ids }
}
