import { parseSceneDocument, type SceneDocument, type SceneDocumentView, type SceneNode, type SceneResource } from '@desktop-webgis/scene-schema'

export interface CreateSceneDocumentOptions {
  id: string
  title: string
  viewId: string
  view: SceneDocumentView
}

/** Creates a content document with an explicit engine view and no runtime state. */
export function createSceneDocument(options: CreateSceneDocumentOptions): SceneDocument {
  return parseSceneDocument({ version: 3, id: options.id, title: options.title, resources: {}, nodes: [],
    views: { [options.viewId]: options.view }, activeView: options.viewId })
}

/** Adds one resource without duplicating it for each display node. */
export function addSceneResource(document: SceneDocument, id: string, resource: SceneResource): SceneDocument {
  if (Object.hasOwn(document.resources, id)) throw new Error(`Resource “${id}” 已存在`)
  return parseSceneDocument({ ...document, resources: { ...document.resources, [id]: resource } })
}

/** Replaces a resource only when all referencing nodes remain valid. */
export function replaceSceneResource(document: SceneDocument, id: string, resource: SceneResource): SceneDocument {
  if (!Object.hasOwn(document.resources, id)) throw new Error(`Resource “${id}” 不存在`)
  return parseSceneDocument({ ...document, resources: { ...document.resources, [id]: resource } })
}

/** Removes a resource; deleting its display nodes requires explicit cascade. */
export function removeSceneResource(document: SceneDocument, id: string, cascade = false): SceneDocument {
  const references = document.nodes.filter(node => 'resource' in node && node.resource === id)
  if (references.length && !cascade) throw new Error(`Resource “${id}” 仍被节点引用`)
  const resources = { ...document.resources }; delete resources[id]
  const removed = new Set(references.map(node => node.id))
  const presentation = removeChapterReferences(document, removed)
  return parseSceneDocument({ ...document, resources, nodes: document.nodes.filter(node => !removed.has(node.id)),
    ...(presentation ? { presentation } : {}) })
}

/** Adds a typed node at an explicit bottom-to-top render position. */
export function addSceneNode(document: SceneDocument, node: SceneNode, index = document.nodes.length): SceneDocument {
  if (!Number.isInteger(index) || index < 0 || index > document.nodes.length) throw new RangeError('节点插入位置超出范围')
  if (document.nodes.some(entry => entry.id === node.id)) throw new Error(`Node “${node.id}” 已存在`)
  const nodes = [...document.nodes]; nodes.splice(index, 0, node)
  return parseSceneDocument({ ...document, nodes })
}

/** Replaces a node definition while keeping identity and render position stable. */
export function replaceSceneNode(document: SceneDocument, id: string, node: SceneNode): SceneDocument {
  if (node.id !== id) throw new Error('替换节点不能修改稳定 ID')
  const index = document.nodes.findIndex(entry => entry.id === id)
  if (index < 0) throw new Error(`Node “${id}” 不存在`)
  const nodes = [...document.nodes]; nodes[index] = node
  return parseSceneDocument({ ...document, nodes })
}

function removeChapterReferences(document: SceneDocument, removed: ReadonlySet<string>): SceneDocument['presentation'] {
  if (!document.presentation) return undefined
  return { ...document.presentation, ...(document.presentation.chapters ? { chapters: document.presentation.chapters.map(chapter => ({
    ...chapter, ...(chapter.visibleLayers ? { visibleLayers: chapter.visibleLayers.filter(id => !removed.has(id)) } : {})
  })) } : {}) }
}

/** Deletes a group only with explicit recursive cascade when it still has children. */
export function removeSceneNode(document: SceneDocument, id: string, cascade = false): SceneDocument {
  const removed = new Set([id])
  for (;;) {
    const children = document.nodes.filter(node => node.parentId !== undefined && removed.has(node.parentId) && !removed.has(node.id))
    if (!children.length) break
    if (!cascade) throw new Error(`Node “${id}” 仍有子节点`)
    for (const child of children) removed.add(child.id)
  }
  const presentation = removeChapterReferences(document, removed)
  return parseSceneDocument({ ...document, nodes: document.nodes.filter(node => !removed.has(node.id)), ...(presentation ? { presentation } : {}) })
}

/** Moves a node into another group and/or render position; validation rejects parent cycles. */
export function moveSceneNode(document: SceneDocument, id: string, index: number, parentId?: string): SceneDocument {
  const previous = document.nodes.find(node => node.id === id)
  if (!previous) throw new Error(`Node “${id}” 不存在`)
  if (!Number.isInteger(index) || index < 0 || index >= document.nodes.length) throw new RangeError('节点移动位置超出范围')
  const { parentId: oldParent, ...definition } = previous
  const node: SceneNode = { ...definition, ...(parentId === undefined ? {} : { parentId }) }
  const nodes = document.nodes.filter(entry => entry.id !== id); nodes.splice(index, 0, node)
  return parseSceneDocument({ ...document, nodes })
}

/** Sets an initial view; selecting it does not modify other engine cameras. */
export function setSceneDocumentView(document: SceneDocument, id: string, view: SceneDocumentView, activate = false): SceneDocument {
  return parseSceneDocument({ ...document, views: { ...document.views, [id]: view }, activeView: activate ? id : document.activeView })
}

/** Replaces the declarative environment, leaving device rendering policy to the host. */
export function setSceneEnvironment(document: SceneDocument, environment: NonNullable<SceneDocument['environment']>): SceneDocument {
  return parseSceneDocument({ ...document, environment })
}

/** Validates before serialization, rejecting values JSON would silently discard. */
export function serializeSceneDocument(document: SceneDocument, space = 2): string {
  return `${JSON.stringify(parseSceneDocument(document), null, space)}\n`
}
