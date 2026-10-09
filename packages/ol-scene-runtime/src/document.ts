import { getUnsupportedSceneExtensions, parseSceneDocument, type SceneDocument, type SceneFilterCondition, type SceneLayer, type SceneSource } from '@desktop-webgis/scene-schema'
import type Feature from 'ol/Feature.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import type Geometry from 'ol/geom/Geometry.js'
import type BaseLayer from 'ol/layer/Base.js'
import LayerGroup from 'ol/layer/Group.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import View from 'ol/View.js'
import { get as getProjection } from 'ol/proj.js'
import { createOlLayerHandle, type OlLayerHandle } from './layer-handle.js'
import type { CreateOlSceneLayerOptions } from './layer.js'
import { createOlStyleFunction } from './style.js'

export interface OlDocumentIssue { path: string; code: string; message: string }
export interface OlDocumentOptions extends Omit<CreateOlSceneLayerOptions, 'vectorSource'> {
  viewId?: string
  /** Sources already projected for the selected view, owned and synchronized by the host. */
  vectorSources?: Readonly<Record<string, VectorSource<Feature<Geometry>>>>
}
export interface OlDocumentLayers {
  readonly view: View
  readonly rootLayers: readonly BaseLayer[]
  readonly issues: readonly OlDocumentIssue[]
  getLayer(id: string): BaseLayer | undefined
  /** Node-filtered records for selection/query; local and ancestor visibility remain host policy. */
  getFilteredFeatures(id: string): readonly Feature<Geometry>[]
  getDocument(): SceneDocument
  /** Returns false when resources, views or hierarchy require preparing new layers. */
  updatePresentation(input: SceneDocument): boolean
  /** Remove root layers from the map first. Owns created layers and shared sources, not the map. */
  dispose(): void
}

const featureIds = new WeakMap<Feature<Geometry>, string | number>()
/** Original portable identity; OpenLayers internally indexes numeric and string IDs together. */
export function getSceneFeatureId(feature: Feature<Geometry>): string | number | undefined { return featureIds.get(feature) ?? feature.getId() }

function matches(value: unknown, condition: SceneFilterCondition): boolean {
  const empty = (entry: unknown): boolean => entry === undefined || entry === null || entry === ''
  const numeric = (entry: unknown): number | null => {
    if (typeof entry !== 'number' && (typeof entry !== 'string' || !entry.trim())) return null
    const number = Number(entry); return Number.isFinite(number) ? number : null
  }
  if (condition.op === 'is-empty') return empty(value)
  if (condition.op === 'is-not-empty') return !empty(value)
  if (condition.op === 'neq') return !matches(value, { ...condition, op: 'eq' })
  if (condition.op === 'eq') {
    if (empty(value) || empty(condition.value)) return empty(value) && empty(condition.value)
    const left = numeric(value), right = numeric(condition.value)
    return left !== null && right !== null ? left === right : String(value) === String(condition.value)
  }
  if (condition.op === 'contains') return !empty(value) && !empty(condition.value) && String(value).toLowerCase().includes(String(condition.value).toLowerCase())
  const left = numeric(value), right = numeric(condition.value)
  if (left === null || right === null) return false
  return condition.op === 'lt' ? left < right : condition.op === 'lte' ? left <= right : condition.op === 'gt' ? left > right : left >= right
}

function nativeNodes(document: SceneDocument): SceneDocument['nodes'] {
  return document.nodes.filter(node => node.type === 'tile' || node.type === 'vector' || node.type === 'group' && node.scope !== '3d')
}

function documentIssues(document: SceneDocument): OlDocumentIssue[] {
  const extensions = getUnsupportedSceneExtensions(document)
  const required = extensions.filter(issue => issue.code === 'extension.required')
  if (required.length) throw new Error(required.map(issue => issue.message).join('; '))
  const issues: OlDocumentIssue[] = extensions.map(({ path, code, message }) => ({ path, code, message }))
  for (const node of document.nodes) {
    if (node.type === 'group' && node.scope === '3d' || node.type !== 'group' && node.type !== 'tile' && node.type !== 'vector') {
      issues.push({ path: `$.nodes.${node.id}`, code: 'ol.unsupported', message: `OL does not render ${node.type}` })
    }
  }
  const resources = new Set(nativeNodes(document).flatMap(node => 'resource' in node ? [node.resource] : []))
  for (const id of resources) {
    if (document.resources[id].type === 'wfs') issues.push({ path: `$.resources.${id}`, code: 'wfs.snapshot', message: 'Displays the saved WFS cache; remote refresh is not performed' })
  }
  return issues
}

/** Shares resource sources without baking node filters into data. Reports unsupported content explicitly. */
export async function createOlDocumentLayers(input: unknown, options: OlDocumentOptions = {}): Promise<OlDocumentLayers> {
  let document = parseSceneDocument(input)
  const viewId = options.viewId ?? document.activeView
  const definition = document.views[viewId]
  if (!definition || definition.type !== '2d') throw new Error(`OL requires a two-dimensional view: ${viewId}`)
  if (!getProjection(definition.projection)) throw new Error(`OL projection is not registered: ${definition.projection}`)
  const view = new View({ ...definition })
  const issues = documentIssues(document)
  const sources: Record<string, SceneSource> = Object.create(null)
  const shared = new Map<string, VectorSource<Feature<Geometry>>>()
  const ownedSources = new Set<VectorSource<Feature<Geometry>>>()
  const handles = new Map<string, OlLayerHandle>(), layers = new Map<string, BaseLayer>()
  const format = new GeoJSON({ featureProjection: view.getProjection() })
  let disposed = false
  function dispose(): void {
    if (disposed) return
    disposed = true
    handles.forEach(handle => handle.dispose())
    layers.forEach(layer => { if (layer instanceof LayerGroup) layer.dispose() })
    ownedSources.forEach(source => source.dispose())
    ownedSources.clear()
    handles.clear(); layers.clear(); shared.clear()
  }
  const abortPreparation = (): void => dispose()
  options.signal?.addEventListener('abort', abortPreparation, { once: true })
  try {
    for (const node of document.nodes) {
      options.signal?.throwIfAborted()
      if (node.type === 'group') {
        if (node.scope === '3d') continue
        layers.set(node.id, new LayerGroup({ layers: [], visible: node.visible }))
        continue
      }
      if (node.type !== 'vector' && node.type !== 'tile') {
        continue
      }
      const resource = document.resources[node.resource]
      if ((resource.type === 'wms' || resource.type === 'wmts') && resource.authMode === 'runtime') throw new Error(`Authenticated service ${node.resource} requires an OL request adapter`)
      if (resource.type === '3dtiles' || resource.type === 'glb') throw new Error(`Unsupported map resource ${node.resource}`)
      sources[node.resource] = resource.type === 'wfs' ? { type: 'geojson', data: resource.snapshot, dataProjection: 'EPSG:4326' } : resource as SceneSource
      if (node.type === 'vector' && !shared.has(node.resource)) {
        const source = sources[node.resource]
        if (source.type !== 'geojson') throw new Error(`Vector node ${node.id} needs GeoJSON or WFS data`)
        const supplied = options.vectorSources?.[node.resource]
        if (supplied) shared.set(node.resource, supplied)
        else {
        let content = source.data
        if (!content) {
          const fetcher = options.fetch ?? globalThis.fetch
          if (!fetcher || !source.url) throw new Error(`Remote GeoJSON ${node.resource} requires a fetch implementation`)
          if (resource.authentication) throw new Error(`Authenticated GeoJSON ${node.resource} requires an OL request adapter`)
          const response = await fetcher(source.url, { signal: options.signal })
          if (!response.ok) throw new Error(`GeoJSON ${node.resource} failed: HTTP ${response.status}`)
          const decoded: unknown = await response.json()
          options.signal?.throwIfAborted()
          const { url, ...inlineDefinition } = source
          const validated = parseSceneDocument({ ...document, resources: { ...document.resources, [node.resource]: { ...inlineDefinition, data: decoded } } }).resources[node.resource]
          if (validated.type !== 'geojson' || !validated.data) throw new Error(`GeoJSON ${node.resource} has no data`)
          content = validated.data
        }
        const data = structuredClone(content)
        const ids = new Set<string>(), portableIds: Array<string | number | undefined> = []
        data.features.forEach(feature => {
          const fieldId = source.idField ? feature.properties?.[source.idField] : undefined
          const id = feature.id ?? (typeof fieldId === 'string' || typeof fieldId === 'number' && Number.isFinite(fieldId) ? fieldId : undefined)
          portableIds.push(id)
          if (id === undefined) return
          const key = `${typeof id}:${id}`
          if (ids.has(key)) throw new Error(`Duplicate feature identity in ${node.resource}: ${key}`)
          ids.add(key); feature.id = key
        })
        const features = format.readFeatures(data, { dataProjection: source.dataProjection ?? 'EPSG:4326' }) as Feature<Geometry>[]
        features.forEach((feature, index) => {
          const id = portableIds[index]
          if (id !== undefined) featureIds.set(feature, id)
        })
        const preparedSource = new VectorSource({ features })
        shared.set(node.resource, preparedSource)
        ownedSources.add(preparedSource)
        }
      }
      const { resource: resourceId, parentId, locked, filter, ...presentation } = node
      const handle = await createOlLayerHandle({ ...presentation, source: resourceId } as SceneLayer, sources, view, { ...options, vectorSource: shared.get(resourceId) })
      handles.set(node.id, handle); layers.set(node.id, handle.layer)
      if (node.type === 'vector' && node.filter?.length && handle.layer instanceof VectorLayer) {
        const style = handle.layer.getStyleFunction()!
        handle.layer.setStyle((feature, resolution) => node.filter!.every(condition => matches(feature.get(condition.field), condition)) ? style(feature, resolution) : undefined)
      }
    }
    const roots: BaseLayer[] = []
    for (const node of document.nodes) {
      const layer = layers.get(node.id)
      if (!layer) continue
      if (node.parentId) {
        const parent = layers.get(node.parentId)
        if (!(parent instanceof LayerGroup)) throw new Error(`Parent group ${node.parentId} is not available in this view`)
        parent.getLayers().push(layer)
      } else roots.push(layer)
    }
    options.signal?.throwIfAborted()
    return {
      view, rootLayers: roots, issues, getLayer: id => layers.get(id),
      updatePresentation(input) {
        if (disposed) throw new Error('Document layers have been disposed')
        const next = parseSceneDocument(input)
        const nextIssues = documentIssues(next)
        const previousNodes = nativeNodes(document), nextNodes = nativeNodes(next)
        const content = (input: SceneDocument) => ({ id: input.id, view: input.views[options.viewId ?? input.activeView], viewId: options.viewId ?? input.activeView,
          credentials: input.credentials, resources: Object.fromEntries(nativeNodes(input).flatMap(node => 'resource' in node ? [[node.resource, input.resources[node.resource]]] : [])) })
        if (JSON.stringify(content(document)) !== JSON.stringify(content(next)) || previousNodes.length !== nextNodes.length) return false
        const identity = (node: SceneDocument['nodes'][number]): unknown => ({
          id: node.id, type: node.type, parentId: node.parentId,
          resource: 'resource' in node ? node.resource : undefined,
          scope: node.type === 'group' ? node.scope : undefined
        })
        if (nextNodes.some((node, index) => JSON.stringify(identity(node)) !== JSON.stringify(identity(previousNodes[index])))) return false
        if (JSON.stringify(previousNodes) === JSON.stringify(nextNodes)) { document = next; issues.splice(0, issues.length, ...nextIssues); return true }
        // Compile every style before writing to any native object.
        nextNodes.forEach(node => { if (node.type === 'vector') createOlStyleFunction(node.style) })
        nextNodes.forEach(node => {
          if (node.type === 'group') { layers.get(node.id)?.setVisible(node.visible); return }
          if (node.type !== 'tile' && node.type !== 'vector') return
          const { resource, parentId, locked, filter, ...presentation } = node
          const handle = handles.get(node.id)
          if (!handle) throw new Error(`Missing layer handle ${node.id}`)
          handle.update({ ...presentation, source: resource } as SceneLayer)
          if (node.type === 'vector' && node.filter?.length && handle.layer instanceof VectorLayer) {
            const style = handle.layer.getStyleFunction()!
            handle.layer.setStyle((feature, resolution) => node.filter!.every(condition => matches(feature.get(condition.field), condition)) ? style(feature, resolution) : undefined)
          }
        })
        document = next
        issues.splice(0, issues.length, ...nextIssues)
        return true
      },
      getFilteredFeatures(id) {
        const layer = layers.get(id), node = document.nodes.find(node => node.id === id)
        if (!(layer instanceof VectorLayer) || node?.type !== 'vector') return []
        const source = layer.getSource() as VectorSource<Feature<Geometry>> | null
        return (source?.getFeatures() ?? []).filter(feature => node.filter?.every(condition => matches(feature.get(condition.field), condition)) ?? true)
      },
      getDocument: () => structuredClone(document), dispose
    }
  } catch (error) { dispose(); throw error }
  finally { options.signal?.removeEventListener('abort', abortPreparation) }
}
