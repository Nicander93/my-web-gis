/** Serializable Cesium 3D scenes. Coordinates use WGS84 degrees and ellipsoid metres. */
import { validateResourceReference, type ResourceReference } from './resource-reference.js'
export { isRuntimeResourceUrl, validateResourceReference, type ResourceReference } from './resource-reference.js'
export type GeoPosition = [longitude: number, latitude: number, height: number]
export type Triple = [number, number, number]

export interface Transform {
  /** East, north, up in metres, relative to the asset's original placement. */
  translation: Triple
  /** Heading, pitch, roll in degrees, in the local ENU frame. */
  rotation: Triple
  scale: number
}

export interface CesiumSceneCamera {
  position: GeoPosition
  heading: number
  pitch: number
  roll: number
}

export interface PopupDefinition {
  title?: string
  titleField?: string
  fields: Array<{ field: string; label?: string }>
}

export interface CesiumSceneAsset {
  type: '3dtiles' | 'glb' | 'geojson'
  /** Legacy HTTP(S) or relative URL. Local references are resolved separately by the host. */
  url?: string
  reference?: ResourceReference
  /** Inline GeoJSON used by document-projected vector resources that have no portable URL. */
  data?: object
}

interface NodeBase {
  id: string
  name: string
  visible: boolean
  popup?: PopupDefinition
  locked?: boolean
  groupId?: string
}

export type GraphicType = 'point' | 'polyline' | 'polygon' | 'rectangle' | 'ellipse'
export type GraphicGeometry = { positions: GeoPosition[]; heightMode: 'ground' | 'absolute' } & ({ type: 'point' } | { type: 'polyline' } | { type: 'polygon' } | { type: 'rectangle' } | { type: 'ellipse' })
export function isParametricGraphic(type: GraphicType): boolean { return type === 'rectangle' || type === 'ellipse' }
export function graphicMinimum(type: GraphicType): number { return type === 'point' ? 1 : type === 'polygon' ? 3 : 2 }
export interface BillboardStyle { image: string; width: number; height: number }
export interface GraphicStyle { color: string; width: number; pointSize: number; label?: string; labelField?: string; billboard?: BillboardStyle }
export { createBillboardStyle } from './graphic-presets.js'

/** Embedded images are portable; external images must use credential-free HTTP(S). */
export function isGraphicImage(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 3_000_000) return false
  if (/^data:image\/(png|jpeg|gif|webp);base64,[a-z\d+/]+={0,2}$/i.test(value)) return true
  if (/^data:image\/svg\+xml,%3Csvg[^\s]+$/i.test(value)) return true
  return /^https?:\/\//i.test(value) && isSceneResourceUrl(value)
}
export interface GraphicNode extends NodeBase {
  type: 'graphic'
  geometry: GraphicGeometry
  style: GraphicStyle
  properties: Record<string, unknown>
}

/** Validates the standalone graphic contract before allocating Cesium objects. */
export function validateGraphic(value: unknown): value is GraphicNode {
  if (!record(value) || value.type !== 'graphic' || typeof value.id !== 'string' || !value.id.trim() || typeof value.name !== 'string' || typeof value.visible !== 'boolean') return false
  const geometry = value.geometry, style = value.style
  if (!record(geometry) || !['point','polyline','polygon','rectangle','ellipse'].includes(String(geometry.type)) || !['ground','absolute'].includes(String(geometry.heightMode)) || !Array.isArray(geometry.positions) || !geometry.positions.every(position)) return false
  const minimum = graphicMinimum(geometry.type as GraphicType)
  if (geometry.positions.length < minimum || (geometry.type === 'point' && geometry.positions.length !== 1)) return false
  if (new Set(geometry.positions.map(p => geometry.type === 'polygon' ? `${p[0]},${p[1]}` : JSON.stringify(p))).size < minimum) return false
  if (isParametricGraphic(geometry.type as GraphicType)) {
    if (geometry.positions.length !== 2) return false
    const [a,b] = geometry.positions, width = Math.abs(a[0] - b[0]), height = Math.abs(a[1] - b[1])
    if (width < 1e-8 || height < 1e-8 || width > 180 || a[2] !== b[2]) return false
    if (geometry.type === 'ellipse' && (width > 10 || height > 10 || Math.max(Math.abs(a[1]), Math.abs(b[1])) > 85)) return false
  }
  if (value.locked !== undefined && typeof value.locked !== 'boolean') return false
  if (value.groupId !== undefined && (typeof value.groupId !== 'string' || !value.groupId.trim())) return false
  if (value.popup !== undefined && !validatePopup(value.popup)) return false
  if (record(style) && style.billboard !== undefined) {
    const icon = style.billboard
    if (geometry.type !== 'point' || !record(icon) || !isGraphicImage(icon.image) || !finite(icon.width) || icon.width < 1 || icon.width > 512 || !finite(icon.height) || icon.height < 1 || icon.height > 512) return false
  }
  return record(style) && typeof style.color === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(style.color) && finite(style.width) && style.width > 0 && style.width <= 64 && finite(style.pointSize) && style.pointSize > 0 && style.pointSize <= 128 && (style.label === undefined || typeof style.label === 'string') && (style.labelField === undefined || typeof style.labelField === 'string' && !!style.labelField.trim()) && record(value.properties) && jsonValue(value.properties)
}

function validatePopup(value: unknown): value is PopupDefinition {
  return record(value) && (value.title === undefined || typeof value.title === 'string') && (value.titleField === undefined || typeof value.titleField === 'string') && Array.isArray(value.fields) && value.fields.every(field => record(field) && typeof field.field === 'string' && (field.label === undefined || typeof field.label === 'string'))
}

// Reject cycles, class instances and values JSON would silently discard.
function jsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || ancestors.has(value)) return false
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false
  ancestors.add(value)
  const valid = Object.values(value).every(child => jsonValue(child, ancestors))
  ancestors.delete(value)
  return valid
}

export interface TilesetNode extends NodeBase {
  type: '3dtiles'
  asset: string
  transform: Transform
  /** Native Cesium3DTileStyle constructor JSON, kept intact for unsupported legal expressions. */
  style?: Record<string, unknown>
  maximumScreenSpaceError?: number
  cacheBytes?: number
  dynamicScreenSpaceError?: boolean
  dynamicScreenSpaceErrorDensity?: number
  dynamicScreenSpaceErrorFactor?: number
  skipLevelOfDetail?: boolean
  effects?: TilesetEffect[]
}

export type ParameterKind = 'boolean' | 'number' | 'enum' | 'color' | 'vector' | 'json' | 'custom'
export type ParameterLifecycle = 'runtime' | 'recreate' | 'readonly' | 'action'
/** Defaults retained by the current Cesium scene runtime when a persisted field is absent. */
export const TILESET_RUNTIME_DEFAULTS = {
  maximumScreenSpaceError: 16,
  cacheBytes: 256 * 1024 * 1024,
  dynamicScreenSpaceError: true,
  dynamicScreenSpaceErrorDensity: 2e-4,
  dynamicScreenSpaceErrorFactor: 24,
  skipLevelOfDetail: false
} as const
export interface ParameterDescriptor<T = unknown> {
  id: string
  owner: 'tileset'
  apiName: string
  group: string
  help: string
  kind: ParameterKind
  lifecycle: ParameterLifecycle
  search: string[]
  defaultValue?: T
  nativeDefaultValue?: T
  min?: number
  max?: number
  step?: number
  validate(value: unknown): value is T
}

function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function isNonNegativeNumber(value: unknown): value is number { return isFiniteNumber(value) && value >= 0 }
function isBoolean(value: unknown): value is boolean { return typeof value === 'boolean' }

/** Initial public writable Cesium3DTileset parameters confirmed against the locked Cesium 1.145.0 source. */
export const TILESET_PARAMETER_DESCRIPTORS: readonly ParameterDescriptor[] = [
  { id: 'tileset.maximumScreenSpaceError', owner: 'tileset', apiName: 'maximumScreenSpaceError', group: '细节与性能', help: '允许的最大屏幕空间误差，数值越小通常显示越精细。', kind: 'number', lifecycle: 'runtime', search: ['误差', '精细度', 'LOD'], defaultValue: TILESET_RUNTIME_DEFAULTS.maximumScreenSpaceError, min: 0, step: 1, validate: isNonNegativeNumber },
  { id: 'tileset.cacheBytes', owner: 'tileset', apiName: 'cacheBytes', group: '细节与性能', help: '瓦片缓存目标字节数；兼容项目未填写时使用 256 MiB，Cesium 原生默认值为 512 MiB。', kind: 'number', lifecycle: 'runtime', search: ['缓存', '内存'], defaultValue: TILESET_RUNTIME_DEFAULTS.cacheBytes, nativeDefaultValue: 512 * 1024 * 1024, min: 0, step: 1048576, validate: isNonNegativeNumber },
  { id: 'tileset.dynamicScreenSpaceError', owner: 'tileset', apiName: 'dynamicScreenSpaceError', group: '细节与性能', help: '按视距动态调整屏幕空间误差。', kind: 'boolean', lifecycle: 'runtime', search: ['动态', '远景'], defaultValue: TILESET_RUNTIME_DEFAULTS.dynamicScreenSpaceError, validate: isBoolean },
  { id: 'tileset.dynamicScreenSpaceErrorDensity', owner: 'tileset', apiName: 'dynamicScreenSpaceErrorDensity', group: '细节与性能', help: '动态误差雾化密度。', kind: 'number', lifecycle: 'runtime', search: ['动态', '密度'], defaultValue: TILESET_RUNTIME_DEFAULTS.dynamicScreenSpaceErrorDensity, min: 0, step: 0.00001, validate: isNonNegativeNumber },
  { id: 'tileset.dynamicScreenSpaceErrorFactor', owner: 'tileset', apiName: 'dynamicScreenSpaceErrorFactor', group: '细节与性能', help: '动态误差强度系数。', kind: 'number', lifecycle: 'runtime', search: ['动态', '强度'], defaultValue: TILESET_RUNTIME_DEFAULTS.dynamicScreenSpaceErrorFactor, min: 0, step: 1, validate: isNonNegativeNumber },
  { id: 'tileset.skipLevelOfDetail', owner: 'tileset', apiName: 'skipLevelOfDetail', group: '细节与性能', help: '允许跳过中间细节层级以减少请求。', kind: 'boolean', lifecycle: 'runtime', search: ['跳级', 'LOD', '请求'], defaultValue: TILESET_RUNTIME_DEFAULTS.skipLevelOfDetail, validate: isBoolean },
  { id: 'tileset.style', owner: 'tileset', apiName: 'style', group: '样式', help: 'Cesium 原生 Cesium3DTileStyle JSON 定义。', kind: 'json', lifecycle: 'runtime', search: ['颜色', '条件', '表达式', '原生 JSON'], validate: validateTilesetStyle },
  { id: 'tileset.url', owner: 'tileset', apiName: 'url', group: '资源', help: '在数据源中修改资源地址；候选资源准备完成后替换现有实例，加载失败保留现有场景。地址归属资源定义。', kind: 'custom', lifecycle: 'recreate', search: ['地址', '重载', '数据源'], validate: isSceneResourceUrl },
  { id: 'tileset.totalMemoryUsageInBytes', owner: 'tileset', apiName: 'totalMemoryUsageInBytes', group: '运行诊断', help: 'Cesium 当前统计的瓦片内存字节数，只读，不进入工程。', kind: 'number', lifecycle: 'readonly', search: ['内存', '诊断'], validate: isNonNegativeNumber },
  { id: 'tileset.trimLoadedTiles', owner: 'tileset', apiName: 'trimLoadedTiles', group: '运行诊断', help: '卸载当前视图不需要的已缓存瓦片；不修改工程或历史。', kind: 'custom', lifecycle: 'action', search: ['缓存', '清理'], validate: (value): value is undefined => value === undefined }
]

export function validateTilesetStyle(value: unknown): value is Record<string, unknown> {
  return record(value) && jsonValue(value)
}

export interface TilesetClipEffect {
  id: string
  kind: 'clip-polygon'
  enabled: boolean
  /** keep-inside maps to Cesium inverse clipping; keep-outside clips polygon interiors. */
  mode: 'keep-inside' | 'keep-outside'
  positions: GeoPosition[]
}

export interface TilesetFlattenEffect {
  id: string
  kind: 'flatten-polygon'
  enabled: boolean
  /** WGS84 ellipsoid height in metres at the local flatten frame origin. */
  height: number
  positions: GeoPosition[]
}

export type TilesetEffect = TilesetClipEffect | TilesetFlattenEffect

export interface ModelNode extends NodeBase {
  type: 'model'
  asset: string
  position: GeoPosition
  transform: Transform
}

export interface GeoJsonNode extends NodeBase {
  type: 'geojson'
  asset: string
  color?: string
}

/** Native scene imagery with an XYZ URL template. */
export interface ImageryNode extends NodeBase {
  type: 'imagery'
  url: string
  attribution?: string
  maximumLevel?: number
  opacity?: number
}

export interface WaterNode extends NodeBase {
  type: 'water'
  /** Open boundary; the runtime closes it. At least three distinct points. */
  boundary: GeoPosition[]
  height: number
  color: string
  amplitude: number
  frequency: number
  speed: number
}

export type CesiumSceneNode = TilesetNode | ModelNode | GeoJsonNode | ImageryNode | WaterNode | GraphicNode
export interface CesiumSceneGroup { id: string; name: string; visible: boolean; locked?: boolean; parentId?: string }
export interface CesiumScene {
  version: 1 | 2
  camera: CesiumSceneCamera
  basemap?: { url: string; attribution?: string }
  terrain?: { url: string }
  assets: Record<string, CesiumSceneAsset>
  nodes: CesiumSceneNode[]
  groups?: CesiumSceneGroup[]
  effects: { fog: number; bloom: boolean }
  lighting?: { sunlight: boolean; shadows: boolean; time: string }
}

export interface CesiumSceneValidationIssue { path: string; message: string }
export function createTransform(): Transform {
  return { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }
}

export function createCesiumScene(): CesiumScene {
  return {
    version: 2,
    camera: { position: [116.391, 39.907, 2500], heading: 0, pitch: -45, roll: 0 },
    assets: {}, nodes: [], effects: { fog: 0, bloom: false }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function triple(value: unknown): value is Triple { return Array.isArray(value) && value.length === 3 && value.every(finite) }
function position(value: unknown): value is GeoPosition {
  return triple(value) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90
}
/** Accepts local relative URLs and HTTP(S), without embedded credentials. */
export function isSceneResourceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || /[\\\u0000-\u0020]/.test(value)) return false
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      let secret = false
      url.searchParams.forEach((_value, key) => { if (/^(token|access_token|key|api_key|apikey|authorization)$/i.test(key)) secret = true })
      return !url.username && !url.password && !secret
    } catch { return false }
  }
  return !/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('/') && !value.split('/').includes('..') && !/[?#]/.test(value)
}

export function validateTransform(value: unknown): value is Transform {
  return record(value) && triple(value.translation) && triple(value.rotation) && finite(value.scale) && value.scale > 0 && value.scale <= 10000
}

/** Validate before creating GPU resources or persisting untrusted scenes. */
export function validateCesiumScene(input: unknown, root = '$'): CesiumSceneValidationIssue[] {
  const issues: CesiumSceneValidationIssue[] = []
  function check(valid: boolean, path: string, message: string): void { if (!valid) issues.push({ path: `${root}.${path}`, message }) }
  if (!record(input)) return [{ path: root, message: '三维场景必须是对象' }]
  check(input.version === 1 || input.version === 2, 'version', '只支持 CesiumScene version 1 或 2')
  if (input.lighting !== undefined) check(input.version === 2 && record(input.lighting) && typeof input.lighting.sunlight === 'boolean' && typeof input.lighting.shadows === 'boolean' && typeof input.lighting.time === 'string' && Number.isFinite(Date.parse(input.lighting.time)), 'lighting', '光照需要 version 2、有效时间和布尔设置')
  const camera = input.camera
  check(record(camera) && position(camera.position) && finite(camera.heading) && finite(camera.pitch) && Math.abs(camera.pitch) <= 90 && finite(camera.roll), 'camera', '相机必须使用有效的经纬度、高度和角度')
  if (input.basemap !== undefined) check(record(input.basemap) && isSceneResourceUrl(input.basemap.url), 'basemap', '底图 URL 无效')
  if (input.terrain !== undefined) check(record(input.terrain) && isSceneResourceUrl(input.terrain.url), 'terrain', '地形 URL 无效')
  check(record(input.effects) && finite(input.effects.fog) && input.effects.fog >= 0 && input.effects.fog <= 1 && typeof input.effects.bloom === 'boolean', 'effects', '雾浓度必须在 0–1 之间，辉光必须是布尔值')
  const assets = record(input.assets) ? input.assets : {}
  check(record(input.assets), 'assets', '资源必须是字典')
  for (const [id, asset] of Object.entries(assets)) {
    if (!Boolean(id.trim()) || !record(asset) || !['3dtiles', 'glb', 'geojson'].includes(String(asset.type))) {
      check(false, `assets.${id}`, '资源类型或 URL 无效'); continue
    }
    if (asset.type === 'geojson') {
      const hasUrl = asset.url !== undefined && isSceneResourceUrl(asset.url)
      const hasData = asset.data !== undefined && record(asset.data)
      check(hasUrl || hasData || validateResourceReference(asset.reference), `assets.${id}`, 'GeoJSON 资源需要有效 URL、引用或内联 data')
      if (asset.url !== undefined) check(isSceneResourceUrl(asset.url), `assets.${id}.url`, '资源 URL 无效')
    } else {
      check(asset.url !== undefined && isSceneResourceUrl(asset.url) || asset.reference !== undefined && validateResourceReference(asset.reference), `assets.${id}`, '资源需要有效 URL 或引用')
    }
    if (asset.url !== undefined) check(isSceneResourceUrl(asset.url), `assets.${id}.url`, '资源 URL 无效')
    if (asset.reference !== undefined) check(validateResourceReference(asset.reference), `assets.${id}.reference`, '资源引用无效')
  }
  const groupIds = new Set<string>()
  if (input.groups !== undefined) {
    check(input.version === 2 && Array.isArray(input.groups), 'groups', '分组需要 version 2 和数组配置')
    if (Array.isArray(input.groups)) input.groups.forEach((group: unknown, i: number) => {
      const path = `groups[${i}]`
      if (!record(group)) { check(false, path, '分组结构无效'); return }
      check(typeof group.id === 'string' && !!group.id.trim() && !groupIds.has(group.id), `${path}.id`, '分组 ID 为空或重复')
      if (typeof group.id === 'string') groupIds.add(group.id)
      check(typeof group.name === 'string' && !!group.name.trim() && typeof group.visible === 'boolean' && (group.locked === undefined || typeof group.locked === 'boolean'), path, '分组名称、显隐或锁定状态无效')
    })
    if (Array.isArray(input.groups)) {
      const parents = new Map(input.groups.filter(record).map(group => [group.id, group.parentId]))
      input.groups.forEach((group: unknown, i: number) => {
        if (!record(group)) return
        if (group.parentId !== undefined) check(typeof group.parentId === 'string' && groupIds.has(group.parentId), `groups[${i}].parentId`, '父文件夹不存在')
        const seen = new Set<unknown>([group.id])
        let parent = group.parentId
        while (parent !== undefined && parents.has(parent)) {
          if (seen.has(parent)) { check(false, `groups[${i}].parentId`, '文件夹层级不能成环'); break }
          seen.add(parent); parent = parents.get(parent)
        }
      })
    }
  }
  if (!Array.isArray(input.nodes)) { check(false, 'nodes', '对象必须是数组'); return issues }
  const ids = new Set<string>()
  input.nodes.forEach((node: unknown, i: number) => {
    const path = `nodes[${i}]`
    if (!record(node)) { check(false, path, '对象结构无效'); return }
    check(typeof node.id === 'string' && Boolean(node.id.trim()) && !ids.has(node.id) && !groupIds.has(node.id), `${path}.id`, '对象 ID 为空或重复，或与分组冲突')
    if (typeof node.id === 'string') ids.add(node.id)
    check(typeof node.name === 'string' && typeof node.visible === 'boolean', path, '对象名称或显隐状态无效')
    if (node.locked !== undefined) check(typeof node.locked === 'boolean', `${path}.locked`, '锁定状态必须是布尔值')
    if (node.groupId !== undefined) check(input.version === 2 && typeof node.groupId === 'string' && groupIds.has(node.groupId), `${path}.groupId`, '分组引用无效或场景版本不支持')
    if (node.popup !== undefined) {
      const popup = node.popup
      check(record(popup) && (popup.title === undefined || typeof popup.title === 'string') && (popup.titleField === undefined || typeof popup.titleField === 'string') && Array.isArray(popup.fields) && popup.fields.every(f => record(f) && typeof f.field === 'string' && (f.label === undefined || typeof f.label === 'string')), `${path}.popup`, 'Popup 字段结构无效')
    }
    if (node.type === 'graphic') {
      check(input.version === 2 && validateGraphic(node), path, '图形需要 version 2 和有效的几何、样式与属性')
      return
    }
    if (node.type === 'imagery') {
      check(isSceneResourceUrl(node.url), `${path}.url`, '影像 URL 无效')
      if (node.attribution !== undefined) check(typeof node.attribution === 'string', `${path}.attribution`, '归属信息必须是字符串')
      if (node.maximumLevel !== undefined) check(finite(node.maximumLevel) && node.maximumLevel >= 0, `${path}.maximumLevel`, '最大级别必须是非负数')
      if (node.opacity !== undefined) check(finite(node.opacity) && node.opacity >= 0 && node.opacity <= 1, `${path}.opacity`, '透明度必须在 0–1 之间')
      return
    }
    if (node.type === 'water') {
      const validBoundary = Array.isArray(node.boundary) && node.boundary.length >= 3 && node.boundary.every(position)
      check(validBoundary && new Set((validBoundary ? node.boundary as GeoPosition[] : []).map(p => `${p[0]},${p[1]}`)).size >= 3, `${path}.boundary`, '水面需要至少三个不同的有效坐标')
      check(finite(node.height) && finite(node.amplitude) && node.amplitude >= 0 && finite(node.frequency) && node.frequency > 0 && finite(node.speed) && node.speed >= 0 && typeof node.color === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(node.color), path, '水面参数无效')
      return
    }
    const asset = typeof node.asset === 'string' ? assets[node.asset] : undefined
    const expected = node.type === 'model' ? 'glb' : node.type
    check(['3dtiles', 'model', 'geojson'].includes(String(node.type)) && record(asset) && asset.type === expected, `${path}.asset`, '对象类型或资源引用不匹配')
    if (node.type === 'model' || node.type === '3dtiles') check(validateTransform(node.transform), `${path}.transform`, '变换参数无效')
    if (node.type === 'model') check(position(node.position), `${path}.position`, '模型位置无效')
    if (node.type === 'geojson' && node.color !== undefined) check(typeof node.color === 'string' && /^#[\da-f]{6}$/i.test(node.color), `${path}.color`, '颜色必须是 #RRGGBB')
    if (node.type === '3dtiles') {
      if (node.maximumScreenSpaceError !== undefined) check(finite(node.maximumScreenSpaceError) && node.maximumScreenSpaceError >= 0, `${path}.maximumScreenSpaceError`, '屏幕误差必须为非负数')
      if (node.cacheBytes !== undefined) check(finite(node.cacheBytes) && node.cacheBytes >= 0, `${path}.cacheBytes`, '缓存预算必须为非负数')
      if (node.style !== undefined) check(validateTilesetStyle(node.style), `${path}.style`, '3D Tiles Style 必须是可序列化 JSON 对象')
      if (node.dynamicScreenSpaceError !== undefined) check(typeof node.dynamicScreenSpaceError === 'boolean', `${path}.dynamicScreenSpaceError`, '动态屏幕空间误差必须是布尔值')
      for (const key of ['dynamicScreenSpaceErrorDensity', 'dynamicScreenSpaceErrorFactor'] as const) if (node[key] !== undefined) check(finite(node[key]) && node[key] >= 0, `${path}.${key}`, '动态屏幕空间误差参数必须是非负有限数')
      if (node.skipLevelOfDetail !== undefined) check(typeof node.skipLevelOfDetail === 'boolean', `${path}.skipLevelOfDetail`, '跳过细节层级必须是布尔值')
      if (node.effects !== undefined) {
        check(input.version === 2 && Array.isArray(node.effects), `${path}.effects`, '裁剪效果需要 version 2 和数组配置')
        const effectIds = new Set<string>()
        if (Array.isArray(node.effects)) node.effects.forEach((effect: unknown, effectIndex: number) => {
          const effectPath = `${path}.effects[${effectIndex}]`
          if (!record(effect)) { check(false, effectPath, '裁剪效果结构无效'); return }
          check(typeof effect.id === 'string' && !!effect.id.trim() && !effectIds.has(effect.id), `${effectPath}.id`, '效果 ID 为空或重复')
          if (typeof effect.id === 'string') effectIds.add(effect.id)
          check(effect.kind === 'clip-polygon' || effect.kind === 'flatten-polygon', `${effectPath}.kind`, '效果类型无效')
          check(typeof effect.enabled === 'boolean', `${effectPath}.enabled`, '启用状态必须是布尔值')
          if (effect.kind === 'clip-polygon') check(effect.mode === 'keep-inside' || effect.mode === 'keep-outside', `${effectPath}.mode`, '裁剪模式无效')
          if (effect.kind === 'flatten-polygon') check(finite(effect.height), `${effectPath}.height`, '压平目标高程必须是有限数值')
          const validPositions = Array.isArray(effect.positions) && effect.positions.length >= 3 && effect.positions.every(position)
          check(validPositions && new Set((validPositions ? effect.positions as GeoPosition[] : []).map(item => `${item[0]},${item[1]}`)).size >= 3, `${effectPath}.positions`, '裁剪范围需要至少三个不同的有效坐标')
        })
      }
    }
  })
  return issues
}

export function parseCesiumScene(input: unknown): CesiumScene {
  const decoded: unknown = typeof input === 'string' ? JSON.parse(input) : input
  const issues = validateCesiumScene(decoded)
  if (issues.length) throw new Error(issues.map(i => `${i.path}: ${i.message}`).join('\n'))
  // Validation establishes the complete serializable contract.
  return structuredClone(decoded) as CesiumScene
}

export { getCesiumSceneNodeState, getCesiumSceneGroupState, getCesiumSceneDescendantIds, moveCesiumSceneNodes, moveCesiumSceneGroup, removeCesiumSceneGroup } from './groups.js'

export * from './compat-city.js'
