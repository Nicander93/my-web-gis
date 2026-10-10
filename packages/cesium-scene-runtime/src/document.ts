import { createCityScene, parseCityScene, type CityNode, type CityScene } from '@desktop-webgis/cesium-scene-schema'
import { getUnsupportedSceneExtensions, parseSceneDocument, type SceneDocument, type SceneLayerStyle, type SceneNode, type SceneSymbol, type SceneColor } from '@desktop-webgis/scene-schema'

export interface CesiumDocumentIssue { path: string; code: string; message: string }
export interface CesiumDocumentProjection {
  scene: CityScene
  document: SceneDocument
  issues: CesiumDocumentIssue[]
}

function sceneColorToHex(color: SceneColor | undefined): string | undefined {
  if (!color) return undefined
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`
}

function symbolColor(symbol: SceneSymbol | undefined): string | undefined {
  if (!symbol) return undefined
  if (symbol.type === 'circle') return sceneColorToHex(symbol.fill) ?? sceneColorToHex(symbol.stroke)
  if (symbol.type === 'solid' && 'color' in symbol) return sceneColorToHex(symbol.color)
  if (symbol.type === 'solid' && 'fill' in symbol) return sceneColorToHex(symbol.fill) ?? sceneColorToHex(symbol.stroke)
  if (symbol.type === 'mixed') {
    return symbolColor(symbol.point) ?? symbolColor(symbol.line) ?? symbolColor(symbol.polygon)
  }
  return undefined
}

/** Maps shared vector style to the single color GeoJsonLayer understands. Complex modes use fallback. */
export function colorFromLayerStyle(style: SceneLayerStyle | undefined): string | undefined {
  if (!style) return undefined
  if (style.mode === 'single') return symbolColor(style.symbol)
  return symbolColor(style.fallback)
}

function matchesFilter(value: unknown, condition: { field: string; op: string; value?: unknown }): boolean {
  if (condition.op === 'is-empty') return value === undefined || value === null || value === ''
  if (condition.op === 'is-not-empty') return !(value === undefined || value === null || value === '')
  if (condition.op === 'eq') return value === condition.value
  if (condition.op === 'neq') return value !== condition.value
  if (condition.op === 'contains') return String(value ?? '').includes(String(condition.value ?? ''))
  if (typeof value !== 'number' || typeof condition.value !== 'number') return false
  if (condition.op === 'lt') return value < condition.value
  if (condition.op === 'lte') return value <= condition.value
  if (condition.op === 'gt') return value > condition.value
  if (condition.op === 'gte') return value >= condition.value
  return false
}

function filterFeatureCollection(data: object, filter: NonNullable<Extract<SceneNode, { type: 'vector' }>['filter']>): object {
  const collection = data as { type?: string; features?: Array<{ properties?: Record<string, unknown> }> }
  if (!Array.isArray(collection.features)) return data
  return {
    ...collection,
    features: collection.features.filter(feature => filter.every(condition => matchesFilter(feature.properties?.[condition.field], condition)))
  }
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
    if (resource.type === '3dtiles' || resource.type === 'glb') {
      scene.assets[id] = { type: resource.type, url: resource.url }
    } else if (resource.type === 'geojson' && resource.url) {
      scene.assets[id] = { type: 'geojson', url: resource.url }
    } else if (resource.type === 'geojson' && resource.data) {
      scene.assets[id] = { type: 'geojson', data: structuredClone(resource.data) }
    }
  }

  for (const node of document.nodes) {
    if (node.type === 'group') continue
    const { visible, locked } = deriveAncestorState(node, nodes)

    if (node.type === 'tile') {
      const resource = document.resources[node.resource]
      if (resource?.type === 'xyz' && !resource.authentication) {
        scene.nodes.push({
          type: 'imagery',
          id: node.id,
          name: node.name,
          visible,
          locked,
          url: resource.url,
          ...(resource.attribution ? { attribution: resource.attribution } : {}),
          ...(resource.maxZoom !== undefined ? { maximumLevel: resource.maxZoom } : {}),
          ...(node.opacity !== undefined ? { opacity: node.opacity } : {})
        })
      } else {
        issues.push({
          path: `$.nodes.${node.id}`,
          code: 'cesium.unsupported',
          message: `The city renderer does not yet render the shared tile resource (${resource?.type ?? 'missing'})`
        })
      }
      continue
    }

    if (node.type === 'vector') {
      const resource = document.resources[node.resource]
      let assetId = node.resource
      if (resource?.type === 'geojson' && (resource.url || resource.data)) {
        if (!scene.assets[assetId]) {
          scene.assets[assetId] = resource.url
            ? { type: 'geojson', url: resource.url }
            : { type: 'geojson', data: structuredClone(resource.data!) }
        }
        if (node.filter?.length && scene.assets[assetId]?.data) {
          assetId = `${node.resource}__${node.id}`
          scene.assets[assetId] = {
            type: 'geojson',
            data: filterFeatureCollection(scene.assets[node.resource].data!, node.filter)
          }
        } else if (node.filter?.length && resource.url) {
          issues.push({
            path: `$.nodes.${node.id}.filter`,
            code: 'cesium.filter.deferred',
            message: 'Remote GeoJSON filters are kept in the document but not applied in the city renderer yet'
          })
        }
      } else if (resource?.type === 'wfs' && resource.snapshot) {
        assetId = node.filter?.length ? `${node.resource}__${node.id}` : `${node.resource}__snapshot`
        const data = node.filter?.length
          ? filterFeatureCollection(resource.snapshot, node.filter)
          : structuredClone(resource.snapshot)
        scene.assets[assetId] = { type: 'geojson', data }
      } else {
        issues.push({
          path: `$.nodes.${node.id}`,
          code: 'cesium.unsupported',
          message: `The city renderer does not yet render the shared vector resource (${resource?.type ?? 'missing'})`
        })
        continue
      }
      const color = colorFromLayerStyle(node.style)
      const popup = node.interaction?.popup
      scene.nodes.push({
        type: 'geojson',
        id: node.id,
        name: node.name,
        visible,
        locked,
        asset: assetId,
        ...(color ? { color } : {}),
        ...(popup ? { popup: { ...(popup.titleField ? { titleField: popup.titleField } : {}), fields: popup.fields.map(({ field, label }) => ({ field, ...(label ? { label } : {}) })) } } : {})
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
  // The legacy renderer has flat groups. Derived ancestor state is confined to this projection.
  return { scene: parseCityScene(scene), document, issues }
}
