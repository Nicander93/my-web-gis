import { createProject, isLegacyStyle, migrateLegacyStyle, normalizeLayerTree, type BasemapConfig, type Dataset, type GisFeature, type ProjectSnapshot, type ServiceSource } from '@desktop-webgis/gis-core'
import { createCityScene, parseCityScene, type CityNode } from '@desktop-webgis/cesium-scene-schema'
import { getUnsupportedSceneExtensions, migrateSceneDocument, parseSceneDocument, type GeoJsonFeatureCollection, type JsonValue, type SceneDocument, type SceneNode, type SceneResource, type SceneResourceMetadata } from '@desktop-webgis/scene-schema'
import { toWmsSceneSource, toWmtsSceneSource } from './compile-project'
import { getProjectType } from '../../services/project-type'

/** Optional fields on typed project definitions are absent in the JSON protocol. */
function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

function allocate(id: string, used: Set<string>): string {
  let next = id, suffix = 2
  while (used.has(next)) next = `${id}-${suffix++}`
  used.add(next); return next
}

function collection(features: GisFeature[]): GeoJsonFeatureCollection {
  return { type: 'FeatureCollection', features: features.map(feature => ({ type: 'Feature', id: feature.metadata?.sceneFeatureId ?? feature.id,
    geometry: structuredClone(feature.geometry), properties: structuredClone(feature.properties) as Record<string, JsonValue> })) }
}

function resourceMetadata(name: string, features?: GisFeature[]): SceneResourceMetadata {
  if (!features) return { title: name }
  const names = [...new Set(features.flatMap(feature => Object.keys(feature.properties)))]
  const fields: NonNullable<SceneResourceMetadata['fields']> = names.map(name => {
    const values = features.map(feature => feature.properties[name])
    const kinds = new Set(values.filter(value => value !== null && value !== undefined).map(value => typeof value))
    const kind = kinds.size === 1 ? [...kinds][0] : 'object'
    return { name, type: kind === 'string' || kind === 'number' || kind === 'boolean' ? kind : 'json', nullable: values.some(value => value === null || value === undefined) }
  })
  const featureMetadata = Object.fromEntries(features.flatMap(feature => {
    if (!feature.metadata) return []
    const { sceneFeatureId, sceneMetadataPresent, ...metadata } = feature.metadata
    const data = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined))
    if (sceneMetadataPresent === false && !Object.keys(data).length) return []
    return [[featureMetadataKey(sceneFeatureId ?? feature.id), data]]
  }))
  return { title: name, fields, ...(Object.keys(featureMetadata).length ? { featureMetadata } : {}) }
}

function authentication(source: ServiceSource, credentials: NonNullable<SceneDocument['credentials']>): SceneResourceMetadata['authentication'] {
  if (source.authMode === 'none') return undefined
  const credential = source.credentialRef?.key
  if (credential) credentials[credential] = { type: 'runtime-reference', key: credential }
  return { mode: source.authMode, ...(credential ? { credential } : {}), ...(source.tokenParam ? { tokenParam: source.tokenParam } : {}) }
}

/** Converts full project content, including all cached data, independently of publishing filters. */
export function createProjectSceneDocument(snapshot: ProjectSnapshot): SceneDocument {
  const project = normalizeLayerTree(snapshot.project)
  const resources: Record<string, SceneResource> = Object.create(null)
  const credentials: NonNullable<SceneDocument['credentials']> = Object.create(null)
  for (const dataset of project.datasets) {
    if (Object.hasOwn(resources, dataset.id)) throw new Error(`Dataset ID “${dataset.id}” 重复`)
    const features = snapshot.featuresByDataset[dataset.id] ?? []
    if (dataset.kind === 'vector') resources[dataset.id] = { type: 'geojson', data: collection(features), dataProjection: 'EPSG:4326', ...resourceMetadata(dataset.name, features), ...(dataset.fields ? { fields: structuredClone(dataset.fields) } : {}) }
    else {
      const auth = authentication(dataset.source, credentials)
      const metadata = { ...resourceMetadata(dataset.name, dataset.kind === 'wfs' ? features : undefined), ...(auth ? { authentication: auth } : {}), ...(dataset.fields ? { fields: structuredClone(dataset.fields) } : {}) }
      if (dataset.kind === 'wms') resources[dataset.id] = { ...toWmsSceneSource(dataset.source), ...metadata }
      else if (dataset.kind === 'wmts') resources[dataset.id] = { ...toWmtsSceneSource(dataset.source), ...metadata }
      else {
        const { credentialRef, tokenParam, authMode, ...source } = dataset.source
        resources[dataset.id] = { ...omitUndefined(source), authMode: authMode === 'none' ? 'none' : 'runtime', snapshot: collection(features), ...metadata }
      }
    }
  }
  const usedResources = new Set(Object.keys(resources))
  const usedNodes = new Set([...project.layers.map(layer => layer.id), ...project.groups.map(group => group.id)])
  if (usedNodes.size !== project.layers.length + project.groups.length) throw new Error('图层或分组 ID 重复')
  const basemapId = allocate('basemap', usedResources), basemapNodeId = allocate('basemap', usedNodes)
  const basemap = project.basemap
  if (basemap.type === 'osm') resources[basemapId] = { type: 'xyz', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors' }
  else if (basemap.type === 'xyz') resources[basemapId] = omitUndefined(basemap)
  else {
    credentials[basemap.credential] = { type: 'runtime-reference', key: basemap.credential }
    resources[basemapId] = basemap.type === 'tianditu' ? { type: 'provider', provider: 'tianditu', mapType: basemap.mapType, credential: basemap.credential,
      ...(basemap.projection ? { projection: basemap.projection } : {}), ...(basemap.withLabels === undefined ? {} : { withLabels: basemap.withLabels }) }
      : { type: 'provider', provider: 'google-map-tiles', mapType: basemap.mapType, credential: basemap.credential, language: basemap.language, region: basemap.region }
  }
  const nodes: SceneNode[] = [{ type: 'tile', id: basemapNodeId, name: '底图', role: 'basemap', visible: true, resource: basemapId }]
  const layers = new Map(project.layers.map(layer => [layer.id, layer]))
  const datasets = new Map(project.datasets.map(dataset => [dataset.id, dataset]))
  const addLayer = (id: string, parentId?: string): void => {
    const layer = layers.get(id)
    if (!layer) throw new Error(`图层 “${id}” 不存在`)
    const dataset = datasets.get(layer.datasetId)
    if (!dataset) throw new Error(`图层 “${id}” 的数据资源不存在`)
    const base = { id: layer.id, name: layer.name, resource: layer.datasetId, visible: layer.visible, opacity: layer.opacity, locked: !layer.editable, ...(parentId ? { parentId } : {}) }
    if (dataset.kind === 'vector' || dataset.kind === 'wfs') nodes.push({ ...base, type: 'vector', style: isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : structuredClone(layer.style),
      ...(layer.filter ? { filter: layer.filter.map(condition => omitUndefined(structuredClone(condition))) as Extract<SceneNode, { type: 'vector' }>['filter'] } : {}) })
    else nodes.push({ ...base, type: 'tile' })
  }
  for (const entry of [...project.rootOrder].reverse()) {
    if (entry.type === 'layer') addLayer(entry.id)
    else {
      const group = project.groups.find(group => group.id === entry.id)!
      nodes.push({ type: 'group', id: group.id, name: group.name, visible: group.visible, scope: '2d' })
      for (const id of [...group.layerIds].reverse()) addLayer(id, group.id)
    }
  }
  const city = project.city ? migrateSceneDocument(project.city, { id: project.id, title: project.name }, { resourceIds: [...usedResources], nodeIds: [...usedNodes] }) : undefined
  Object.assign(resources, city?.resources)
  return parseSceneDocument({ version: 3, id: project.id, title: project.name, resources, nodes: [...nodes, ...city?.nodes ?? []],
    views: { map: { type: '2d', projection: project.crs, ...project.mapState }, ...city?.views }, activeView: city && getProjectType(project) === '3d' ? 'city' : 'map',
    ...(city?.environment ? { environment: city.environment } : {}), ...(Object.keys(credentials).length ? { credentials } : {}) })
}

function restoreAuthentication(resource: SceneResource, document: SceneDocument): Pick<ServiceSource, 'authMode' | 'tokenParam' | 'credentialRef'> {
  const auth = resource.authentication
  if ('authMode' in resource && resource.authMode === 'runtime' && !auth) throw new Error('恢复服务前必须提供明确的认证方式')
  return { authMode: auth?.mode ?? 'none', ...(auth?.tokenParam ? { tokenParam: auth.tokenParam } : {}),
    ...(auth?.credential ? { credentialRef: { key: document.credentials![auth.credential].key } } : {}) }
}

function restoreFeatures(resource: SceneResource): GisFeature[] {
  if (resource.type === 'geojson' && resource.dataProjection !== undefined && resource.dataProjection !== 'EPSG:4326') throw new Error('导入工程前必须将矢量数据转换为 EPSG:4326')
  const data = resource.type === 'wfs' ? resource.snapshot : resource.type === 'geojson' ? resource.data : undefined
  if (!data) throw new Error('导入远程矢量资源前必须准备完整数据')
  const ids = new Set<string | number>()
  const hostIds = new Set(data.features.filter(feature => typeof feature.id === 'string').map(feature => String(feature.id)))
  return data.features.map(feature => {
    if ((typeof feature.id !== 'string' && typeof feature.id !== 'number') || ids.has(feature.id) || !feature.geometry || feature.geometry.type === 'GeometryCollection') throw new Error('当前工程需要唯一的字符串／数字要素 ID 和受支持的非空几何')
    ids.add(feature.id)
    const geometry = feature.geometry
    if (!supportedProjectCoordinates(geometry.coordinates)) throw new Error('当前工程坐标必须是二维或三维有限数值')
    const id = typeof feature.id === 'string' && feature.id ? feature.id : allocate(`scene-${feature.id}`, hostIds)
    const metadata = resource.featureMetadata?.[featureMetadataKey(feature.id)] as GisFeature['metadata']
    return { id, geometry: structuredClone(geometry) as GisFeature['geometry'], properties: structuredClone(feature.properties ?? {}),
      ...(id !== feature.id ? { metadata: { ...structuredClone(metadata), sceneFeatureId: feature.id, sceneMetadataPresent: metadata !== undefined } }
        : metadata === undefined ? {} : { metadata: structuredClone(metadata) }) }
  })
}

function featureMetadataKey(id: string | number): string { return `${typeof id}:${id}` }

function supportedProjectCoordinates(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  if (!value.length) return true
  if (typeof value[0] === 'number') return value.length >= 2 && value.length <= 3 && value.every(coordinate => typeof coordinate === 'number' && Number.isFinite(coordinate))
  return value.every(supportedProjectCoordinates)
}

/** Restores supported project content atomically in memory; unsupported content fails before Store writes. */
export function createProjectFromSceneDocument(input: unknown): ProjectSnapshot {
  const document = parseSceneDocument(input)
  if (getUnsupportedSceneExtensions(document).length) throw new Error('当前工程尚不支持场景扩展，请保留原始文档')
  const mapViews = Object.values(document.views).filter(view => view.type === '2d')
  const cityViews = Object.values(document.views).filter(view => view.type === '3d')
  if (mapViews.length > 1 || cityViews.length > 1) throw new Error('当前工程只支持每种引擎一个初始视图')
  if (document.presentation || document.widgets || document.theme || document.metadata) throw new Error('当前工程尚未保存场景展示配置或扩展元数据，请保留原始文档')
  const project = createProject(document.title), featuresByDataset: ProjectSnapshot['featuresByDataset'] = Object.create(null)
  project.id = document.id
  project.settings.workspaceType = document.views[document.activeView].type
  const view = mapViews[0]
  if (view && (view.extent !== undefined || view.minZoom !== undefined || view.maxZoom !== undefined)) throw new Error('当前工程尚不支持保存二维视图约束，不能静默丢弃')
  if (view) { project.crs = view.projection; project.mapState = { center: view.center, zoom: view.zoom, rotation: view.rotation ?? 0 } }
  const mapNodes = document.nodes.filter(node => node.type === 'tile' || node.type === 'vector')
  const basemaps = mapNodes.filter(node => node.type === 'tile' && node.role === 'basemap')
  if (basemaps.length > 1) throw new Error('当前工程只支持一个二维底图')
  if (basemaps.length) {
    const resource = document.resources[basemaps[0].resource]
    if (resource.type === 'xyz') project.basemap = { type: 'xyz', url: resource.url, ...(resource.attribution ? { attribution: resource.attribution } : {}), ...(resource.maxZoom === undefined ? {} : { maxZoom: resource.maxZoom }) }
    else if (resource.type === 'provider') {
      const { type, provider, ...source } = resource
      project.basemap = { ...source, type: provider, credential: document.credentials![resource.credential].key } as BasemapConfig
    } else throw new Error('二维底图类型不受工程支持')
  }
  const basemapResources = new Set(basemaps.map(node => node.resource))
  for (const [id, resource] of Object.entries(document.resources)) {
    if (basemapResources.has(id) || resource.type === '3dtiles' || resource.type === 'glb') continue
    const isMapResource = mapNodes.some(node => node.resource === id)
    if (!isMapResource && resource.type === 'geojson' && resource.url) continue
    const name = resource.title ?? id
    let dataset: Dataset
    if (resource.type === 'geojson') { dataset = { id, name, kind: 'vector', source: { type: 'memory', label: name } }; featuresByDataset[id] = restoreFeatures(resource) }
    else if (resource.type === 'wfs') {
      const { snapshot, authentication, title, fields, featureMetadata, authMode, ...source } = resource
      dataset = { id, name, kind: 'wfs', source: { ...source, ...restoreAuthentication(resource, document) } }; featuresByDataset[id] = restoreFeatures(resource)
    } else if (resource.type === 'wms' || resource.type === 'wmts') {
      const { authentication, title, fields, featureMetadata, authMode, ...source } = resource
      dataset = resource.type === 'wms' ? { id, name, kind: 'wms', source: { ...source, ...restoreAuthentication(resource, document) } as Extract<Dataset, { kind: 'wms' }>['source'] }
        : { id, name, kind: 'wmts', source: { ...source, ...restoreAuthentication(resource, document) } as Extract<Dataset, { kind: 'wmts' }>['source'] }
    } else throw new Error(`当前工程不支持独立资源 ${id}（${resource.type}）`)
    if (resource.fields) dataset.fields = structuredClone(resource.fields)
    project.datasets.push(dataset)
  }
  const grouped = new Set<string>()
  for (const node of [...document.nodes].reverse()) {
    if (node.type === 'tile' && node.role === 'basemap') continue
    if (node.type !== 'tile' && node.type !== 'vector') continue
    if (node.minZoom !== undefined || node.maxZoom !== undefined || node.type === 'vector' && node.interaction) throw new Error('当前工程尚不支持图层缩放限制或二维 Popup，不能静默丢弃')
    project.layers.push({ id: node.id, name: node.name, datasetId: node.resource, visible: node.visible ?? true, opacity: node.opacity ?? 1, editable: node.type === 'vector' && !node.locked,
      style: node.type === 'vector' ? node.style : { kind: 'mixed', stroke: '#000000', fill: '#000000', width: 1, pointRadius: 4 }, ...(node.type === 'vector' && node.filter ? { filter: node.filter } : {}) })
    if (node.parentId) grouped.add(node.id)
  }
  const groups = document.nodes.filter((node): node is Extract<SceneNode, { type: 'group' }> => node.type === 'group' && (node.scope === '2d' || node.scope === undefined && mapViews.length > 0 && cityViews.length === 0 || document.nodes.some(child => child.parentId === node.id && (child.type === 'tile' || child.type === 'vector'))))
  for (const group of groups) {
    if (group.parentId || group.locked) throw new Error('当前二维工程不支持嵌套或锁定分组')
    project.groups.push({ id: group.id, name: group.name, visible: group.visible, layerIds: project.layers.filter(layer => document.nodes.find(node => node.id === layer.id)?.parentId === group.id).map(layer => layer.id) })
  }
  for (const node of [...document.nodes].reverse()) {
    if (groups.some(group => group.id === node.id)) project.rootOrder.push({ type: 'group', id: node.id })
    else if (project.layers.some(layer => layer.id === node.id) && !grouped.has(node.id)) project.rootOrder.push({ type: 'layer', id: node.id })
  }
  if (cityViews.length || document.nodes.some(node => !['tile', 'vector', 'group'].includes(node.type))) {
    const city = createCityScene(), mapGroups = new Set(groups.map(group => group.id))
    if (cityViews[0]) city.camera = cityViews[0].camera
    Object.assign(city, document.environment)
    city.groups = document.nodes.filter(node => node.type === 'group' && !mapGroups.has(node.id)).map(node => {
      if (node.type !== 'group' || node.parentId) throw new Error('当前三维工程不支持嵌套分组')
      return { id: node.id, name: node.name, visible: node.visible, ...(node.locked === undefined ? {} : { locked: node.locked }) }
    })
    city.nodes = document.nodes.filter(node => !['tile', 'vector', 'group'].includes(node.type)).map(node => {
      const { parentId, ...definition } = node
      if ('resource' in definition) {
        const { resource: id, ...rest } = definition, resource = document.resources[id]
        if (resource.type !== '3dtiles' && resource.type !== 'glb' && (resource.type !== 'geojson' || !resource.url)) throw new Error('三维对象资源类型不受支持')
        city.assets[id] = { type: resource.type, url: resource.url! }
        return { ...rest, asset: id, ...(parentId ? { groupId: parentId } : {}) } as CityNode
      }
      return { ...definition, ...(parentId ? { groupId: parentId } : {}) } as CityNode
    })
    for (const [id, resource] of Object.entries(document.resources)) if (resource.type === '3dtiles' || resource.type === 'glb' || resource.type === 'geojson' && resource.url && !mapNodes.some(node => node.resource === id)) city.assets[id] = { type: resource.type, url: resource.url! }
    project.city = parseCityScene(city)
  }
  return { project, featuresByDataset }
}
