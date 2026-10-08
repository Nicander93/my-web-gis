import { createCityScene, parseCityScene, type CityNode, type CityScene } from '@desktop-webgis/cesium-scene-schema'
import { getUnsupportedSceneExtensions, parseSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'

export interface CesiumDocumentIssue { path: string; code: string; message: string }
export interface CesiumDocumentProjection {
  scene: CityScene
  document: SceneDocument
  issues: CesiumDocumentIssue[]
}

/** Projects supported native city content; the full document retains all other engine content. */
export function projectCesiumDocument(input: unknown, viewId?: string): CesiumDocumentProjection {
  const document = parseSceneDocument(input), view = document.views[viewId ?? document.activeView]
  if (!view || view.type !== '3d') throw new Error('Cesium requires a three-dimensional view')
  const extensions = getUnsupportedSceneExtensions(document)
  if (extensions.some(issue => issue.code === 'extension.required')) throw new Error(extensions.filter(issue => issue.code === 'extension.required').map(issue => issue.message).join('; '))
  const issues: CesiumDocumentIssue[] = extensions.map(({ path, code, message }) => ({ path, code, message }))
  const scene = createCityScene()
  scene.camera = structuredClone(view.camera)
  Object.assign(scene, structuredClone(document.environment ?? {}))
  const nodes = new Map(document.nodes.map(node => [node.id, node]))
  for (const [id, resource] of Object.entries(document.resources)) {
    if (resource.type === '3dtiles' || resource.type === 'glb' || resource.type === 'geojson' && resource.url) scene.assets[id] = { type: resource.type, url: resource.url! }
  }
  for (const node of document.nodes) {
    if (node.type === 'group') continue
    if (node.type === 'tile' || node.type === 'vector') {
      issues.push({ path: `$.nodes.${node.id}`, code: 'cesium.unsupported', message: `The city renderer does not yet render the shared ${node.type} node` }); continue
    }
    const { parentId, ...definition } = node
    let visible = node.visible, locked = node.locked ?? false, parent = parentId
    while (parent) {
      const group = nodes.get(parent)
      if (!group || group.type !== 'group') throw new Error(`Invalid parent group ${parent}`)
      visible = visible && group.visible; locked = locked || Boolean(group.locked); parent = group.parentId
    }
    if ('resource' in definition) {
      const { resource, ...content } = definition
      if (!scene.assets[resource]) throw new Error(`Resource ${resource} must be prepared for the city renderer`)
      scene.nodes.push({ ...content, asset: resource, visible, locked } as CityNode)
    } else scene.nodes.push({ ...definition, visible, locked } as CityNode)
  }
  // The legacy renderer has flat groups. Derived ancestor state is confined to this projection.
  return { scene: parseCityScene(scene), document, issues }
}
