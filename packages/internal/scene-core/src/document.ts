import { reconcileSceneCartography, parseSceneDocument, type SceneDocument, type SceneDocumentView, type SceneNode, type SceneResource } from '@desktop-webgis/scene-schema'

export interface CreateSceneDocumentOptions {
  id: string
  title: string
  viewId: string
  view: SceneDocumentView
}

/** 创建一份带明确引擎视图、不含运行时状态的内容文档。 */
export function createSceneDocument(options: CreateSceneDocumentOptions): SceneDocument {
  return parseSceneDocument({ version: 3, id: options.id, title: options.title, resources: {}, nodes: [],
    views: { [options.viewId]: options.view }, activeView: options.viewId })
}

/** 添加一个资源，不会为每个显示节点各复制一份。 */
export function addSceneResource(document: SceneDocument, id: string, resource: SceneResource): SceneDocument {
  if (Object.hasOwn(document.resources, id)) throw new Error(`Resource “${id}” 已存在`)
  return parseSceneDocumentEdit(document, { ...document, resources: { ...document.resources, [id]: resource } })
}

/** 只有在所有引用节点仍然有效时，才替换资源。 */
export function replaceSceneResource(document: SceneDocument, id: string, resource: SceneResource): SceneDocument {
  if (!Object.hasOwn(document.resources, id)) throw new Error(`Resource “${id}” 不存在`)
  return parseSceneDocumentEdit(document, { ...document, resources: { ...document.resources, [id]: resource } })
}

/** 移除一个资源；要一并删除它的显示节点，必须显式要求级联。 */
export function removeSceneResource(document: SceneDocument, id: string, cascade = false): SceneDocument {
  const references = document.nodes.filter(node => 'resource' in node && node.resource === id)
  if (references.length && !cascade) throw new Error(`Resource “${id}” 仍被节点引用`)
  const resources = { ...document.resources }; delete resources[id]
  const removed = new Set(references.map(node => node.id))
  const presentation = removeChapterReferences(document, removed)
  return parseSceneDocumentEdit(document, { ...document, resources, nodes: document.nodes.filter(node => !removed.has(node.id)),
    ...(presentation ? { presentation } : {}) })
}

/** 在指定的自下而上渲染位置添加一个类型化节点。 */
export function addSceneNode(document: SceneDocument, node: SceneNode, index = document.nodes.length): SceneDocument {
  if (!Number.isInteger(index) || index < 0 || index > document.nodes.length) throw new RangeError('节点插入位置超出范围')
  if (document.nodes.some(entry => entry.id === node.id)) throw new Error(`Node “${node.id}” 已存在`)
  const nodes = [...document.nodes]; nodes.splice(index, 0, node)
  return parseSceneDocumentEdit(document, { ...document, nodes })
}

/** 替换节点定义，同时保持身份和渲染位置不变。 */
export function replaceSceneNode(document: SceneDocument, id: string, node: SceneNode): SceneDocument {
  if (node.id !== id) throw new Error('替换节点不能修改稳定 ID')
  const index = document.nodes.findIndex(entry => entry.id === id)
  if (index < 0) throw new Error(`Node “${id}” 不存在`)
  const nodes = [...document.nodes]; nodes[index] = node
  return parseSceneDocumentEdit(document, { ...document, nodes })
}

function removeChapterReferences(document: SceneDocument, removed: ReadonlySet<string>): SceneDocument['presentation'] {
  if (!document.presentation) return undefined
  return { ...document.presentation, ...(document.presentation.chapters ? { chapters: document.presentation.chapters.map(chapter => ({
    ...chapter, ...(chapter.visibleLayers ? { visibleLayers: chapter.visibleLayers.filter(id => !removed.has(id)) } : {})
  })) } : {}) }
}

/** 分组仍有子节点时，只有显式要求递归级联才能删除。 */
export function removeSceneNode(document: SceneDocument, id: string, cascade = false): SceneDocument {
  const removed = new Set([id])
  for (;;) {
    const children = document.nodes.filter(node => node.parentId !== undefined && removed.has(node.parentId) && !removed.has(node.id))
    if (!children.length) break
    if (!cascade) throw new Error(`Node “${id}” 仍有子节点`)
    for (const child of children) removed.add(child.id)
  }
  const presentation = removeChapterReferences(document, removed)
  return parseSceneDocumentEdit(document, { ...document, nodes: document.nodes.filter(node => !removed.has(node.id)), ...(presentation ? { presentation } : {}) })
}

/** 把节点移到另一个分组，或改变渲染位置；校验会拒绝形成父级循环。 */
export function moveSceneNode(document: SceneDocument, id: string, index: number, parentId?: string): SceneDocument {
  const previous = document.nodes.find(node => node.id === id)
  if (!previous) throw new Error(`Node “${id}” 不存在`)
  if (!Number.isInteger(index) || index < 0 || index >= document.nodes.length) throw new RangeError('节点移动位置超出范围')
  const { parentId: oldParent, ...definition } = previous
  const node: SceneNode = { ...definition, ...(parentId === undefined ? {} : { parentId }) }
  const nodes = document.nodes.filter(entry => entry.id !== id); nodes.splice(index, 0, node)
  return parseSceneDocumentEdit(document, { ...document, nodes })
}

/** 设置一个初始视图；选中它不会改动其它引擎的相机。 */
export function setSceneDocumentView(document: SceneDocument, id: string, view: SceneDocumentView, activate = false): SceneDocument {
  return parseSceneDocumentEdit(document, { ...document, views: { ...document.views, [id]: view }, activeView: activate ? id : document.activeView })
}

/** 替换声明式的环境设置，设备的渲染策略仍然交给宿主。 */
export function setSceneEnvironment(document: SceneDocument, environment: NonNullable<SceneDocument['environment']>): SceneDocument {
  return parseSceneDocumentEdit(document, { ...document, environment })
}

/** 序列化之前先校验，拒绝那些 JSON 会静默丢弃的值。 */
export function serializeSceneDocument(document: SceneDocument, space = 2): string {
  return `${JSON.stringify(parseSceneDocument(document), null, space)}\n`
}

/** 校验结果文档之前，只同步显式的节点操作。 */
function parseSceneDocumentEdit(previous: SceneDocument, next: SceneDocument): SceneDocument {
  return parseSceneDocument(reconcileSceneCartography(next, previous))
}
