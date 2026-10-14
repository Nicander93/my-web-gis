import { createCityScene, parseCityScene, type CityNode, type CityScene } from '@desktop-webgis/cesium-scene-schema'
import { getUnsupportedSceneExtensions, parseSceneDocument, type SceneDocument, type SceneNode } from '@desktop-webgis/scene-schema'

export interface CesiumDocumentIssue { path: string; code: string; message: string }
export interface CesiumDocumentProjection {
  scene: CityScene
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

/** Projects supported native city content; the full document retains all other engine content. */
export function projectCesiumDocument(input: unknown, viewId?: string): CesiumDocumentProjection {
  const document = parseSceneDocument(input), view = document.views[viewId ?? document.activeView]
  if (!view || view.type !== '3d') throw new Error('Cesium requires a three-dimensional view')
  const extensions = getUnsupportedSceneExtensions(document)
  if (extensions.some(issue => issue.code === 'extension.required')) {
    throw new Error(extensions.filter(issue => issue.code === 'extension.required').map(issue => issue.message).join('; '))
  }
  const issues: CesiumDocumentIssue[] = extensions.map(({ path, code, message }) => ({ path, code, message }))
  const scene = createCityScene()
  scene.camera = structuredClone(view.camera)
  Object.assign(scene, structuredClone(document.environment ?? {}))
  const nodes = new Map(document.nodes.map(node => [node.id, node]))

  for (const [id, resource] of Object.entries(document.resources)) {
    // Map-only resources remain in the document, not in the native scene or its update comparisons.
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
      scene.nodes.push({ ...content, asset: resource, visible, locked } as CityNode)
    } else {
      scene.nodes.push({ ...definition, visible, locked } as CityNode)
    }
  }
  // Render objects use derived ancestor flags; the document retains the full editorial hierarchy.
  return { scene: parseCityScene(scene), document, issues }
}
