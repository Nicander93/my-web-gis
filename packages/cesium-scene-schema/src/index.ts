/** Serializable city scenes. Coordinates use WGS84 degrees and ellipsoid metres. */
export type GeoPosition = [longitude: number, latitude: number, height: number]
export type Triple = [number, number, number]

export interface Transform {
  /** East, north, up in metres, relative to the asset's original placement. */
  translation: Triple
  /** Heading, pitch, roll in degrees, in the local ENU frame. */
  rotation: Triple
  scale: number
}

export interface CityCamera {
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

export interface CityAsset {
  type: '3dtiles' | 'glb' | 'geojson'
  /** HTTP(S) or a relative URL. Credentials are supplied by the host. */
  url: string
}

interface NodeBase {
  id: string
  name: string
  visible: boolean
  popup?: PopupDefinition
  locked?: boolean
}

export type GraphicType = 'point' | 'polyline' | 'polygon'
export interface GraphicGeometry { type: GraphicType; positions: GeoPosition[]; heightMode: 'ground' | 'absolute' }
export interface GraphicStyle { color: string; width: number; pointSize: number; label?: string }
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
  if (!record(geometry) || !['point','polyline','polygon'].includes(String(geometry.type)) || !['ground','absolute'].includes(String(geometry.heightMode)) || !Array.isArray(geometry.positions) || !geometry.positions.every(position)) return false
  const minimum = geometry.type === 'point' ? 1 : geometry.type === 'polyline' ? 2 : 3
  if (geometry.positions.length < minimum || (geometry.type === 'point' && geometry.positions.length !== 1)) return false
  if (new Set(geometry.positions.map(p => geometry.type === 'polygon' ? `${p[0]},${p[1]}` : JSON.stringify(p))).size < minimum) return false
  if (value.locked !== undefined && typeof value.locked !== 'boolean') return false
  if (value.popup !== undefined && !validatePopup(value.popup)) return false
  return record(style) && typeof style.color === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(style.color) && finite(style.width) && style.width > 0 && style.width <= 64 && finite(style.pointSize) && style.pointSize > 0 && style.pointSize <= 128 && (style.label === undefined || typeof style.label === 'string') && record(value.properties) && jsonValue(value.properties)
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
  maximumScreenSpaceError?: number
  cacheBytes?: number
}

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

export type CityNode = TilesetNode | ModelNode | GeoJsonNode | WaterNode | GraphicNode
export interface CityScene {
  version: 1 | 2
  camera: CityCamera
  basemap?: { url: string; attribution?: string }
  terrain?: { url: string }
  assets: Record<string, CityAsset>
  nodes: CityNode[]
  effects: { fog: number; bloom: boolean }
  lighting?: { sunlight: boolean; shadows: boolean; time: string }
}

export interface CityValidationIssue { path: string; message: string }
export function createTransform(): Transform {
  return { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }
}

export function createCityScene(): CityScene {
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
export function isCityResourceUrl(value: unknown): value is string {
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
export function validateCityScene(input: unknown, root = '$'): CityValidationIssue[] {
  const issues: CityValidationIssue[] = []
  function check(valid: boolean, path: string, message: string): void { if (!valid) issues.push({ path: `${root}.${path}`, message }) }
  if (!record(input)) return [{ path: root, message: '三维场景必须是对象' }]
  check(input.version === 1 || input.version === 2, 'version', '只支持 CityScene version 1 或 2')
  if (input.lighting !== undefined) check(input.version === 2 && record(input.lighting) && typeof input.lighting.sunlight === 'boolean' && typeof input.lighting.shadows === 'boolean' && typeof input.lighting.time === 'string' && Number.isFinite(Date.parse(input.lighting.time)), 'lighting', '光照需要 version 2、有效时间和布尔设置')
  const camera = input.camera
  check(record(camera) && position(camera.position) && finite(camera.heading) && finite(camera.pitch) && Math.abs(camera.pitch) <= 90 && finite(camera.roll), 'camera', '相机必须使用有效的经纬度、高度和角度')
  if (input.basemap !== undefined) check(record(input.basemap) && isCityResourceUrl(input.basemap.url), 'basemap', '底图 URL 无效')
  if (input.terrain !== undefined) check(record(input.terrain) && isCityResourceUrl(input.terrain.url), 'terrain', '地形 URL 无效')
  check(record(input.effects) && finite(input.effects.fog) && input.effects.fog >= 0 && input.effects.fog <= 1 && typeof input.effects.bloom === 'boolean', 'effects', '雾浓度必须在 0–1 之间，辉光必须是布尔值')
  const assets = record(input.assets) ? input.assets : {}
  check(record(input.assets), 'assets', '资源必须是字典')
  for (const [id, asset] of Object.entries(assets)) {
    check(Boolean(id.trim()) && record(asset) && ['3dtiles', 'glb', 'geojson'].includes(String(asset.type)) && isCityResourceUrl(asset.url), `assets.${id}`, '资源类型或 URL 无效')
  }
  if (!Array.isArray(input.nodes)) { check(false, 'nodes', '对象必须是数组'); return issues }
  const ids = new Set<string>()
  input.nodes.forEach((node: unknown, i: number) => {
    const path = `nodes[${i}]`
    if (!record(node)) { check(false, path, '对象结构无效'); return }
    check(typeof node.id === 'string' && Boolean(node.id.trim()) && !ids.has(node.id), `${path}.id`, '对象 ID 为空或重复')
    if (typeof node.id === 'string') ids.add(node.id)
    check(typeof node.name === 'string' && typeof node.visible === 'boolean', path, '对象名称或显隐状态无效')
    if (node.locked !== undefined) check(typeof node.locked === 'boolean', `${path}.locked`, '锁定状态必须是布尔值')
    if (node.popup !== undefined) {
      const popup = node.popup
      check(record(popup) && (popup.title === undefined || typeof popup.title === 'string') && (popup.titleField === undefined || typeof popup.titleField === 'string') && Array.isArray(popup.fields) && popup.fields.every(f => record(f) && typeof f.field === 'string' && (f.label === undefined || typeof f.label === 'string')), `${path}.popup`, 'Popup 字段结构无效')
    }
    if (node.type === 'graphic') {
      check(input.version === 2 && validateGraphic(node), path, '图形需要 version 2 和有效的几何、样式与属性')
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
      if (node.maximumScreenSpaceError !== undefined) check(finite(node.maximumScreenSpaceError) && node.maximumScreenSpaceError > 0, `${path}.maximumScreenSpaceError`, '屏幕误差必须为正数')
      if (node.cacheBytes !== undefined) check(finite(node.cacheBytes) && node.cacheBytes > 0, `${path}.cacheBytes`, '缓存预算必须为正数')
    }
  })
  return issues
}

export function parseCityScene(input: unknown): CityScene {
  const decoded: unknown = typeof input === 'string' ? JSON.parse(input) : input
  const issues = validateCityScene(decoded)
  if (issues.length) throw new Error(issues.map(i => `${i.path}: ${i.message}`).join('\n'))
  // Validation establishes the complete serializable contract.
  return structuredClone(decoded) as CityScene
}
