import { createCityScene, parseCityScene, validateCityScene, type CityCamera, type CityNode, type CityScene } from '@desktop-webgis/cesium-scene-schema'
import { parseScene, SceneValidationError } from './parse.js'
import { validateScene } from './validate.js'
import type { GeoJsonFeatureCollection, JsonValue, SceneManifest, SceneSource, SceneView, TileLayer, VectorLayer, ValidationIssue, ValidationResult } from './types.js'

export const SCENE_DOCUMENT_VERSION = 3 as const

/** Resources have stable identity independently of the objects displaying them. */
export interface WfsSceneResource {
  type: 'wfs'
  url: string
  version: string
  typeName: string
  outputFormat?: string
  maxFeatures?: number
  srsName?: string
  bboxWgs84?: [number, number, number, number]
  queryExtentWgs84?: [number, number, number, number]
  extentMode?: 'view' | 'full'
  paginationUsed?: boolean
  loadedCount?: number
  complete?: boolean
  truncatedByLimit?: boolean
  duplicateIdCount?: number
  lastLoadedAt?: string
  authMode: 'none' | 'runtime'
  /** Complete local cache before node filters; does not imply the remote query was complete. */
  snapshot: GeoJsonFeatureCollection
}

export interface SceneResourceMetadata {
  title?: string
  fields?: Array<{ name: string; type: 'string' | 'number' | 'boolean' | 'json'; nullable: boolean }>
  /** Keys use `${typeof feature.id}:${feature.id}` so numeric and string IDs stay distinct. */
  featureMetadata?: Record<string, { sourceId?: string | number; overlaySourceId?: string; sourceCrs?: string; importId?: string }>
  authentication?: { mode: 'query-token' | 'bearer'; credential?: string; tokenParam?: string }
}

export type SceneResource = (SceneSource | WfsSceneResource | { type: '3dtiles' | 'glb'; url: string }) & SceneResourceMetadata

export interface SceneFilterCondition {
  field: string
  op: 'eq' | 'neq' | 'contains' | 'lt' | 'lte' | 'gt' | 'gte' | 'is-empty' | 'is-not-empty'
  value?: JsonValue
}

export interface SceneGroupNode {
  type: 'group'
  id: string
  name: string
  visible: boolean
  locked?: boolean
  parentId?: string
  scope?: '2d' | '3d'
}

type MapNode<T> = T extends TileLayer | VectorLayer ? Omit<T, 'source'> & { resource: string; parentId?: string; locked?: boolean; filter?: SceneFilterCondition[] } : never
type CityDocumentNode<T> = T extends CityNode ? Omit<T, 'asset' | 'groupId'> & { parentId?: string } & (T extends { asset: string } ? { resource: string } : {}) : never
export type SceneNode = SceneGroupNode | MapNode<TileLayer | VectorLayer> | CityDocumentNode<CityNode>
export type SceneDocumentView = ({ type: '2d' } & SceneView) | { type: '3d'; camera: CityCamera; heightReference: 'ellipsoid' }

export interface SceneDocumentExtension {
  version: number
  required: boolean
  data: JsonValue
}

/** Content only: no selection, undo history, native objects, device settings or secrets. */
export interface SceneDocument {
  version: 3
  id: string
  title: string
  description?: string
  resources: Record<string, SceneResource>
  /** Bottom-to-top render order. Groups organize nodes without overriding local visibility. */
  nodes: SceneNode[]
  views: Record<string, SceneDocumentView>
  activeView: string
  environment?: {
    basemap?: CityScene['basemap']
    terrain?: CityScene['terrain']
    effects?: CityScene['effects']
    lighting?: CityScene['lighting']
  }
  credentials?: SceneManifest['credentials']
  widgets?: SceneManifest['widgets']
  theme?: SceneManifest['theme']
  presentation?: SceneManifest['presentation']
  metadata?: Record<string, JsonValue>
  extensions?: Record<string, SceneDocumentExtension>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function json(value: unknown, parents = new Set<object>(), depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || parents.has(value) || depth > 100) return false
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false
  parents.add(value)
  const valid = Object.values(value).every(child => json(child, parents, depth + 1))
  parents.delete(value)
  return valid
}

const ROOT_FIELDS = new Set(['version', 'id', 'title', 'description', 'resources', 'nodes', 'views', 'activeView', 'environment', 'credentials', 'widgets', 'theme', 'presentation', 'metadata', 'extensions'])
const FILTER_OPERATIONS = new Set(['eq', 'neq', 'contains', 'lt', 'lte', 'gt', 'gte', 'is-empty', 'is-not-empty'])
const CITY_TYPES = new Set(['3dtiles', 'model', 'geojson', 'graphic', 'water'])

/** Validates JSON structure, engine contracts and references before allocating any runtime object. */
export function validateSceneDocument(input: unknown): ValidationResult {
  const issues: ValidationIssue[] = []
  const check = (valid: boolean, path: string, code: string, message: string): void => { if (!valid) issues.push({ path, code, message }) }
  if (!record(input) || !json(input)) return { valid: false, issues: [{ path: '$', code: 'document.json', message: '场景必须是有限、无循环的普通 JSON 对象' }] }
  for (const key of Object.keys(input)) check(ROOT_FIELDS.has(key), `$.${key}`, 'field.unknown', '未知顶层字段，请使用命名空间扩展')
  check(input.version === 3, '$.version', 'document.version', '只支持 SceneDocument version 3')
  for (const key of ['id', 'title']) check(typeof input[key] === 'string' && Boolean(input[key].trim()), `$.${key}`, 'string.empty', '必须是非空字符串')
  check(input.description === undefined || typeof input.description === 'string', '$.description', 'type.string', '描述必须是字符串')
  check(input.metadata === undefined || record(input.metadata), '$.metadata', 'type.object', '元数据必须是字典')
  check(record(input.resources), '$.resources', 'type.object', '资源必须是字典')
  check(record(input.views) && Object.keys(input.views).length > 0, '$.views', 'type.object', '至少需要一个视图')
  check(Array.isArray(input.nodes), '$.nodes', 'type.array', '节点必须是数组')
  const resources = record(input.resources) ? input.resources : {}
  const views = record(input.views) ? input.views : {}
  check(typeof input.activeView === 'string' && Object.hasOwn(views, input.activeView), '$.activeView', 'reference.view', '活动视图不存在')
  const nodes = Array.isArray(input.nodes) ? input.nodes : []
  const ids = new Map<string, Record<string, unknown>>()
  const mapLayers: Record<string, unknown>[] = [], cityNodes: Record<string, unknown>[] = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i], path = `$.nodes[${i}]`
    if (!record(node)) { check(false, path, 'type.object', '节点必须是对象'); continue }
    check(typeof node.id === 'string' && Boolean(node.id.trim()) && !ids.has(node.id), `${path}.id`, 'node.id', '节点 ID 为空或重复')
    if (typeof node.id === 'string') ids.set(node.id, node)
    check(typeof node.name === 'string' && Boolean(node.name.trim()), `${path}.name`, 'string.empty', '节点名称必须非空')
    check(node.visible === undefined || typeof node.visible === 'boolean', `${path}.visible`, 'type.boolean', '显隐必须是布尔值')
    if (node.type === 'group') check(typeof node.visible === 'boolean', `${path}.visible`, 'type.boolean', '分组需要本地显隐状态')
    if (node.type === 'group') check(node.scope === undefined || node.scope === '2d' || node.scope === '3d', `${path}.scope`, 'group.scope', '分组 scope 必须是 2d 或 3d')
    check(node.locked === undefined || typeof node.locked === 'boolean', `${path}.locked`, 'type.boolean', '锁定必须是布尔值')
    if (node.resource !== undefined) check(typeof node.resource === 'string' && Object.hasOwn(resources, node.resource), `${path}.resource`, 'reference.resource', '资源引用不存在')
    if (node.filter !== undefined) check((node.type === 'vector') && Array.isArray(node.filter) && node.filter.every(condition => record(condition) && typeof condition.field === 'string' && Boolean(condition.field.trim()) && FILTER_OPERATIONS.has(String(condition.op)) && (['is-empty', 'is-not-empty'].includes(String(condition.op)) || Object.hasOwn(condition, 'value'))), `${path}.filter`, 'node.filter', '过滤条件必须使用支持的字段操作和值')
    const { resource, parentId, filter, ...definition } = node
    if (node.type === 'vector' || node.type === 'tile') mapLayers.push({ ...definition, source: resource })
    else if (CITY_TYPES.has(String(node.type))) cityNodes.push({ ...definition, ...(resource === undefined ? {} : { asset: resource }) })
    else check(node.type === 'group', `${path}.type`, 'node.type', '未知节点类型')
  }
  for (const [id, node] of ids) {
    if (node.parentId === undefined) continue
    check(typeof node.parentId === 'string' && ids.get(node.parentId)?.type === 'group', `$.nodes.${id}.parentId`, 'reference.parent', '父节点必须是存在的分组')
    const visited = new Set<string>([id])
    const scope = node.type === 'group' ? node.scope : node.type === 'tile' || node.type === 'vector' ? '2d' : '3d'
    let parent: unknown = node.parentId
    while (typeof parent === 'string' && ids.has(parent)) {
      if (visited.has(parent)) { check(false, `$.nodes.${id}.parentId`, 'group.cycle', '分组不能形成循环'); break }
      const group = ids.get(parent)!
      check(scope === undefined || group.scope === undefined || scope === group.scope, `$.nodes.${id}.parentId`, 'group.scope', '节点与父分组的引擎范围必须一致')
      visited.add(parent); parent = group.parentId
    }
  }
  const mapSources: Record<string, unknown> = Object.create(null), assets: Record<string, unknown> = Object.create(null)
  for (const [id, resource] of Object.entries(resources)) {
    check(Boolean(id.trim()), `$.resources.${id}`, 'resource.id', '资源 ID 不得为空')
    if (!record(resource)) { check(false, `$.resources.${id}`, 'type.object', '资源必须是对象'); continue }
    const path = `$.resources.${id}`
    check(resource.title === undefined || typeof resource.title === 'string', `${path}.title`, 'type.string', '资源名称必须是字符串')
    if (resource.featureMetadata !== undefined) check(record(resource.featureMetadata) && Object.entries(resource.featureMetadata).every(([key, metadata]) => /^(string|number):/.test(key) && record(metadata)
      && Object.keys(metadata).every(name => ['sourceId', 'overlaySourceId', 'sourceCrs', 'importId'].includes(name))
      && (metadata.sourceId === undefined || typeof metadata.sourceId === 'string' || typeof metadata.sourceId === 'number')
      && ['overlaySourceId', 'sourceCrs', 'importId'].every(name => metadata[name] === undefined || typeof metadata[name] === 'string')), `${path}.featureMetadata`, 'resource.featureMetadata', '要素元数据必须使用 typed ID 键和支持的来源字段')
    if (resource.fields !== undefined) {
      const names = new Set<string>()
      check(Array.isArray(resource.fields) && resource.fields.every(field => {
        if (!record(field) || typeof field.name !== 'string' || !field.name.trim() || names.has(field.name) || !['string', 'number', 'boolean', 'json'].includes(String(field.type)) || typeof field.nullable !== 'boolean') return false
        names.add(field.name); return true
      }), `${path}.fields`, 'resource.fields', '字段必须有唯一名称、支持的类型与 nullable')
    }
    if (resource.authentication !== undefined) {
      const authentication = resource.authentication
      check(record(authentication) && ['query-token', 'bearer'].includes(String(authentication.mode)) && (authentication.credential === undefined || typeof authentication.credential === 'string' && record(input.credentials) && Object.hasOwn(input.credentials, authentication.credential)) && (authentication.tokenParam === undefined || typeof authentication.tokenParam === 'string'), `${path}.authentication`, 'resource.authentication', '认证方式或凭据引用无效')
      if (['wms', 'wmts', 'wfs'].includes(String(resource.type))) check(resource.authMode === 'runtime', `${path}.authentication`, 'resource.authentication', '有认证配置时必须使用 runtime 认证模式')
    }
    if (resource.type === '3dtiles' || resource.type === 'glb') assets[id] = resource
    else if (resource.type === 'wfs') {
      for (const key of ['url', 'version', 'typeName']) check(typeof resource[key] === 'string' && Boolean(resource[key].trim()), `${path}.${key}`, 'wfs.string', 'WFS 必须提供非空服务配置')
      check(resource.authMode === 'none' || resource.authMode === 'runtime', `${path}.authMode`, 'wfs.authMode', '认证模式必须是 none 或 runtime')
      for (const key of ['complete', 'paginationUsed', 'truncatedByLimit']) check(resource[key] === undefined || typeof resource[key] === 'boolean', `${path}.${key}`, 'type.boolean', '必须是布尔值')
      for (const key of ['maxFeatures', 'loadedCount', 'duplicateIdCount']) check(resource[key] === undefined || Number.isInteger(resource[key]) && Number(resource[key]) >= (key === 'maxFeatures' ? 1 : 0), `${path}.${key}`, 'wfs.count', '数量必须是有效整数')
      for (const key of ['bboxWgs84', 'queryExtentWgs84']) check(resource[key] === undefined || Array.isArray(resource[key]) && resource[key].length === 4 && resource[key].every(value => typeof value === 'number' && Number.isFinite(value)), `${path}.${key}`, 'wfs.extent', '范围必须是四个有限数值')
      check(resource.extentMode === undefined || resource.extentMode === 'view' || resource.extentMode === 'full', `${path}.extentMode`, 'wfs.extentMode', '查询范围模式无效')
      for (const key of ['outputFormat', 'srsName', 'lastLoadedAt']) check(resource[key] === undefined || typeof resource[key] === 'string', `${path}.${key}`, 'type.string', '必须是字符串')
      check(resource.lastLoadedAt === undefined || typeof resource.lastLoadedAt === 'string' && Number.isFinite(Date.parse(resource.lastLoadedAt)), `${path}.lastLoadedAt`, 'wfs.timestamp', '快照时间无效')
      check(!(resource.complete === true && resource.truncatedByLimit === true), `${path}.complete`, 'wfs.completeness', '截断快照不能标记为完整')
      if (record(resource.snapshot) && Array.isArray(resource.snapshot.features) && resource.loadedCount !== undefined) check(resource.loadedCount === resource.snapshot.features.length, `${path}.loadedCount`, 'wfs.loadedCount', 'loadedCount 必须与本地快照实际数量一致')
      mapSources[id] = { type: 'geojson', data: resource.snapshot, dataProjection: 'EPSG:4326' }
      // Validate the service URL through the existing protocol URL rules as well as the snapshot.
      const urlIssues = validateScene({ version: 2, id: 'check', title: 'Check', view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }, sources: { service: { type: 'geojson', url: resource.url } }, layers: [] }).issues
      issues.push(...urlIssues.map(issue => ({ ...issue, path: `${path}.url` })))
    }
    else {
      mapSources[id] = resource
      if (resource.type === 'geojson' && resource.url !== undefined) assets[id] = { type: 'geojson', url: resource.url }
    }
  }
  const mapView = { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }
  const mapBase = { version: 2, id: input.id, title: input.title, sources: mapSources, layers: mapLayers,
    ...(input.credentials === undefined ? {} : { credentials: input.credentials }), ...(input.widgets === undefined ? {} : { widgets: input.widgets }),
    ...(input.theme === undefined ? {} : { theme: input.theme }), ...(input.presentation === undefined ? {} : { presentation: input.presentation }) }
  const mapIssues = validateScene({ ...mapBase, view: mapView }).issues
  issues.push(...mapIssues.map(issue => ({ ...issue, path: issue.path.replace('$.sources', '$.resources').replace('$.layers', '$.mapNodes') })))
  for (const [id, view] of Object.entries(views)) {
    check(Boolean(id.trim()), `$.views.${id}`, 'view.id', '视图 ID 不得为空')
    if (record(view) && view.type === '2d') {
      const { type, ...definition } = view
      issues.push(...validateScene({ ...mapBase, layers: [], view: definition }).issues.filter(issue => issue.path.startsWith('$.view')).map(issue => ({ ...issue, path: issue.path.replace('$.view', `$.views.${id}`) })))
    } else if (record(view) && view.type === '3d') {
      check(view.heightReference === 'ellipsoid', `$.views.${id}.heightReference`, 'view.heightReference', '三维相机高度使用椭球米')
      issues.push(...validateCityScene({ ...createCityScene(), camera: view.camera }).map(issue => ({ ...issue, code: 'city.validation', path: issue.path.replace('$.camera', `$.views.${id}.camera`) })))
    } else check(false, `$.views.${id}`, 'view.type', '视图类型必须是 2d 或 3d')
  }
  const environment = input.environment === undefined ? {} : input.environment
  check(record(environment), '$.environment', 'type.object', '环境必须是对象')
  if (record(environment)) for (const key of Object.keys(environment)) check(['basemap', 'terrain', 'effects', 'lighting'].includes(key), `$.environment.${key}`, 'field.unknown', '未知环境字段')
  const city = { ...createCityScene(), ...(record(environment) ? environment : {}), assets, nodes: cityNodes }
  issues.push(...validateCityScene(city).map(issue => ({ ...issue, code: 'city.validation', path: issue.path.replace('$.assets', '$.resources').replace('$.nodes', '$.cityNodes') })))
  if (input.extensions !== undefined) {
    check(record(input.extensions), '$.extensions', 'type.object', '扩展必须是字典')
    if (record(input.extensions)) for (const [name, extension] of Object.entries(input.extensions)) {
      check(/^[a-z][a-z\d-]*(\.[a-z][a-z\d-]*)+$/i.test(name) && record(extension) && Number.isInteger(extension.version) && Number(extension.version) > 0 && typeof extension.required === 'boolean' && Object.hasOwn(extension, 'data'), `$.extensions.${name}`, 'extension.definition', '扩展需要命名空间、正整数版本、required 和 JSON 数据')
    }
  }
  return { valid: issues.length === 0, issues }
}

function allocateId(id: string, used: Set<string>): string {
  let result = id, suffix = 2
  while (used.has(result)) result = `${id}-${suffix++}`
  used.add(result)
  return result
}

/** Migrates old map manifests and standalone city scenes into one resource/node namespace. */
export function migrateSceneDocument(input: unknown, identity = { id: 'city-scene', title: '三维场景' }, reserved: { nodeIds?: readonly string[]; resourceIds?: readonly string[] } = {}): SceneDocument {
  let decoded: unknown = input
  if (typeof input === 'string') {
    try { decoded = JSON.parse(input) as unknown }
    catch { throw new SceneValidationError([{ path: '$', code: 'json.syntax', message: 'JSON 解析失败' }]) }
  }
  if (record(decoded) && decoded.version === 3) return parseSceneDocument(decoded)
  const manifest = record(decoded) && Object.hasOwn(decoded, 'sources') ? parseScene(decoded) : undefined
  const city = manifest?.city ?? (manifest ? undefined : parseCityScene(decoded))
  const resources: Record<string, SceneResource> = manifest ? structuredClone(manifest.sources) : Object.create(null)
  const nodes: SceneNode[] = manifest ? manifest.layers.map(({ source, ...layer }) => ({ ...layer, resource: source })) : []
  const views: Record<string, SceneDocumentView> = manifest ? { map: { type: '2d', ...manifest.view } } : {}
  const resourceIds = new Set([...Object.keys(resources), ...reserved.resourceIds ?? []]), nodeIds = new Set([...nodes.map(node => node.id), ...reserved.nodeIds ?? []])
  if (city) {
    const assets = new Map<string, string>(), groups = new Map<string, string>()
    for (const [id, asset] of Object.entries(city.assets)) {
      const next = allocateId(id, resourceIds); assets.set(id, next)
      resources[next] = asset.type === 'geojson' ? { type: 'geojson', url: asset.url } : { type: asset.type, url: asset.url }
    }
    for (const group of city.groups ?? []) {
      const id = allocateId(group.id, nodeIds); groups.set(group.id, id); nodes.push({ ...group, id, type: 'group', scope: '3d' })
    }
    for (const node of city.nodes) {
      const { groupId, ...definition } = node
      const migrated = { ...structuredClone(definition), id: allocateId(node.id, nodeIds), ...(groupId ? { parentId: groups.get(groupId) } : {}) }
      if ('asset' in migrated) {
        const { asset, ...rest } = migrated
        nodes.push({ ...rest, resource: assets.get(asset)! } as SceneNode)
      } else nodes.push(migrated)
    }
    views.city = { type: '3d', camera: structuredClone(city.camera), heightReference: 'ellipsoid' }
  }
  const document: SceneDocument = {
    version: 3, id: manifest?.id ?? identity.id, title: manifest?.title ?? identity.title, resources, nodes, views, activeView: manifest ? 'map' : 'city',
    ...(manifest?.description === undefined ? {} : { description: manifest.description }),
    ...(manifest?.credentials === undefined ? {} : { credentials: manifest.credentials }),
    ...(manifest?.widgets === undefined ? {} : { widgets: manifest.widgets }),
    ...(manifest?.theme === undefined ? {} : { theme: manifest.theme }),
    ...(manifest?.presentation === undefined ? {} : { presentation: manifest.presentation }),
    ...(manifest?.metadata === undefined ? {} : { metadata: manifest.metadata }),
    ...(city ? { environment: { effects: city.effects, ...(city.lighting ? { lighting: city.lighting } : {}), ...(city.basemap ? { basemap: city.basemap } : {}), ...(city.terrain ? { terrain: city.terrain } : {}) } } : {})
  }
  return parseSceneDocument(document)
}

/** Parses canonical v3 JSON. Legacy imports use migrateSceneDocument explicitly. */
export function parseSceneDocument(input: unknown): SceneDocument {
  let decoded: unknown = input
  if (typeof input === 'string') {
    try { decoded = JSON.parse(input) as unknown }
    catch { throw new SceneValidationError([{ path: '$', code: 'json.syntax', message: 'JSON 解析失败' }]) }
  }
  const result = validateSceneDocument(decoded)
  if (!result.valid) throw new SceneValidationError(result.issues)
  return structuredClone(decoded) as SceneDocument
}

/** Unknown extension data is preserved; runtimes must block complete recovery for required ones. */
export function getUnsupportedSceneExtensions(document: SceneDocument, supported: Readonly<Record<string, readonly number[]>> = {}): ValidationIssue[] {
  return Object.entries(document.extensions ?? {}).filter(([name, extension]) => !supported[name]?.includes(extension.version)).map(([name, extension]) => ({
    path: `$.extensions.${name}`, code: extension.required ? 'extension.required' : 'extension.optional', message: `不支持扩展 ${name} version ${extension.version}`
  }))
}
