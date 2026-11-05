import { createCesiumScene, parseCesiumScene, type CesiumSceneNode, type CesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { CARTOGRAPHY_SCENE_EXTENSIONS, getUnsupportedSceneExtensions, parseSceneDocument, type SceneDocument, type SceneNode } from '@desktop-webgis/scene-schema'

export interface CesiumDocumentIssue { path: string; code: string; message: string }
export interface CesiumDocumentProjection {
  scene: CesiumScene
  document: SceneDocument
  issues: CesiumDocumentIssue[]
}

function deriveAncestorState(node: SceneNode, nodes: Map<string, SceneNode>): { visible: boolean; locked: boolean } {
  let visible = 'visible' in node ? node.visible !== false : true
  let locked = 'locked' in node ? Boolean(node.locked) : false
  let parent = 'parentId' in node ? node.parentId : undefined
  while (parent) {
    const group = nodes.get(parent)
    if (!group || group.type !== 'group') throw new Error(`Invalid parent group ${parent}`)
    visible = visible && group.visible
    locked = locked || Boolean(group.locked)
    parent = group.parentId
  }
  return { visible, locked }
}

/** 投影受支持的原生城市内容；完整文档里仍然保留其它引擎的内容。 */
export function projectCesiumDocument(input: unknown, viewId?: string): CesiumDocumentProjection {
  const document = parseSceneDocument(input), view = document.views[viewId ?? document.activeView]
  if (!view || view.type !== '3d') throw new Error('Cesium requires a three-dimensional view')
  const extensions = getUnsupportedSceneExtensions(document, CARTOGRAPHY_SCENE_EXTENSIONS)
  if (extensions.some(issue => issue.code === 'extension.required')) {
    throw new Error(extensions.filter(issue => issue.code === 'extension.required').map(issue => issue.message).join('; '))
  }
  const issues: CesiumDocumentIssue[] = extensions.map(({ path, code, message }) => ({ path, code, message }))
  const scene = createCesiumScene()
  scene.camera = structuredClone(view.camera)
  Object.assign(scene, structuredClone(document.environment ?? {}))
  const nodes = new Map(document.nodes.map(node => [node.id, node]))

  for (const [id, resource] of Object.entries(document.resources)) {
    // 只在二维使用的资源仍留在文档里，不进入原生场景，也不参与它的更新比对。
    if (!document.nodes.some(node => node.type !== 'vector' && node.type !== 'tile' && 'resource' in node && node.resource === id)) continue
    if (resource.type === '3dtiles' || resource.type === 'glb') {
      scene.assets[id] = { type: resource.type, ...(resource.url === undefined ? {} : { url: resource.url }), ...(resource.reference ? { reference: resource.reference } : {}) }
    } else if (resource.type === 'geojson') {
      scene.assets[id] = { type: 'geojson',
        ...(resource.url === undefined ? {} : { url: resource.url }),
        ...(resource.reference ? { reference: structuredClone(resource.reference) } : {}),
        ...(resource.data ? { data: structuredClone(resource.data) } : {}) }
    }
  }

  for (const node of document.nodes) {
    if (node.type === 'group') continue
    const { visible, locked } = deriveAncestorState(node, nodes)

    if (node.type === 'tile' || node.type === 'vector') {
      issues.push({
        path: `$.nodes.${node.id}`,
        code: 'cesium.unsupported',
        message: '2D map nodes are retained in the document and rendered only in the 2D workspace'
      })
      continue
    }

    const { parentId, ...definition } = node
    if ('resource' in definition) {
      const { resource, ...content } = definition
      if (!scene.assets[resource]) throw new Error(`Resource ${resource} must be prepared for the city renderer`)
      scene.nodes.push({ ...content, asset: resource, visible, locked } as CesiumSceneNode)
    } else {
      scene.nodes.push({ ...definition, visible, locked } as CesiumSceneNode)
    }
  }
  // 渲染对象使用推导出的祖先状态；文档里保留完整的编辑期层级。
  return { scene: parseCesiumScene(scene), document, issues }
}
