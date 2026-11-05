import type {
  ServiceDescription,
  ServiceLayerInfo,
  WfsOutputFormatKind,
  WfsResolvedOutputFormat
} from './types.js'

/** Phase product guardrail — not a performance claim. */
export const WFS_DEFAULT_MAX_FEATURES = 5000
export const WFS_PHASE_MAX_FEATURES = 50000

export type WfsExtentMode = 'view' | 'full'

export interface ResolveWfsSelection {
  typeName: string
  /** 首选的输出格式值，会对照已公布的列表来解析。 */
  outputFormat?: string
  srsName?: string
  maxFeatures?: number
  extentMode?: WfsExtentMode
  /** extentMode=view 时，当前地图视图的 WGS84 范围 [西,南,东,北]。 */
  viewExtentWgs84?: [number, number, number, number]
}

export interface ResolvedWfsLoadOptions {
  typeName: string
  version: string
  /** 可分享的 GetFeature 基地址，不含密钥。 */
  getFeatureUrl: string
  outputFormat: WfsResolvedOutputFormat
  srsName: string
  /** 内部记录用的 BBOX，按 WGS84 的经度、纬度顺序。 */
  queryExtentWgs84?: [number, number, number, number]
  extentMode: WfsExtentMode
  maxFeatures: number
  /** 是否尝试使用 startIndex 翻页。 */
  usePaging: boolean
  /** 要素类型公布的 CRS 列表，默认项排在最前。 */
  availableCrs: string[]
}

export type ResolveWfsResult =
  | { ok: true; options: ResolvedWfsLoadOptions }
  | { ok: false; reason: string }

const GEOJSON_HINTS = [
  'application/json',
  'application/geo+json',
  'geojson',
  'json',
  'text/json'
]

const GML_HINTS = [
  'application/gml+xml',
  'text/xml; subtype=gml',
  'gml3',
  'gml2',
  'gml32',
  'gml21',
  'gml'
]

/** Normalize urn:ogc:def:crs:EPSG::4326 → EPSG:4326 when possible. */
export function normalizeWfsCrs(crs: string | undefined): string | undefined {
  if (!crs) return undefined
  const trimmed = crs.trim()
  const urn = /urn:ogc:def:crs:EPSG::(\d+)/i.exec(trimmed)
  if (urn) return `EPSG:${urn[1]}`
  const epsg = /EPSG[:\s]*(\d+)/i.exec(trimmed)
  if (epsg) return `EPSG:${epsg[1]}`
  return trimmed
}

export function clampWfsMaxFeatures(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.floor(value!) : WFS_DEFAULT_MAX_FEATURES
  if (n < 1) return 1
  if (n > WFS_PHASE_MAX_FEATURES) return WFS_PHASE_MAX_FEATURES
  return n
}

function classifyOutputFormat(value: string): WfsOutputFormatKind {
  const lower = value.toLowerCase()
  if (GEOJSON_HINTS.some((h) => lower.includes(h))) return 'geojson'
  if (GML_HINTS.some((h) => lower.includes(h))) return 'gml'
  return 'other'
}

/**
 * 优先 GeoJSON；否则用受支持的 GML 路径；再否则取第一个公布的或安全的默认值。
 */
export function pickWfsOutputFormat(
  advertised: string[] | undefined,
  preferred?: string
): WfsResolvedOutputFormat {
  const list = (advertised ?? []).map((v) => v.trim()).filter(Boolean)
  if (preferred) {
    const hit = list.find((v) => v.toLowerCase() === preferred.toLowerCase())
    if (hit) return { value: hit, kind: classifyOutputFormat(hit) }
    // 即使没有列出也允许调用方覆盖（有些服务会省略 OutputFormat 枚举）。
    return { value: preferred, kind: classifyOutputFormat(preferred) }
  }
  const geo = list.find((v) => classifyOutputFormat(v) === 'geojson')
  if (geo) return { value: geo, kind: 'geojson' }
  const gml = list.find((v) => classifyOutputFormat(v) === 'gml')
  if (gml) return { value: gml, kind: 'gml' }
  if (list[0]) return { value: list[0], kind: classifyOutputFormat(list[0]) }
  // Capabilities 省略列表时，采用 GeoServer 常见的默认值。
  return { value: 'application/json', kind: 'geojson' }
}

function findFeatureType(
  description: ServiceDescription,
  typeName: string
): ServiceLayerInfo | undefined {
  const pools = [
    ...(description.featureTypes ?? []),
    ...description.layers
  ]
  return pools.find((ft) => ft.name === typeName)
}

/**
 * 根据 Capabilities 和用户的选择，解析出 WFS 的加载选项。
 * 不发起请求，也不修改项目状态。
 */
export function resolveWfsLoadOptions(
  description: ServiceDescription,
  selection: ResolveWfsSelection
): ResolveWfsResult {
  if (description.service !== 'WFS') {
    return { ok: false, reason: '当前描述不是 WFS Capabilities' }
  }
  const version = description.version || '2.0.0'
  if (!version.startsWith('2.0') && !version.startsWith('1.1')) {
    return {
      ok: false,
      reason: `本阶段仅支持 WFS 2.0.0 / 1.1.0，当前为 ${version}`
    }
  }

  const ft = findFeatureType(description, selection.typeName)
  if (!ft?.name) {
    return { ok: false, reason: `未找到要素类型: ${selection.typeName}` }
  }

  const availableCrs = [
    ft.defaultCrs,
    ...(ft.crs ?? []),
    ...(ft.otherCrs ?? [])
  ]
    .map((c) => normalizeWfsCrs(c) || c)
    .filter((c): c is string => Boolean(c))
  const uniqueCrs = [...new Set(availableCrs)]

  const preferredSrs =
    normalizeWfsCrs(selection.srsName) ||
    uniqueCrs.find((c) => c.toUpperCase() === 'EPSG:4326') ||
    uniqueCrs.find((c) => c.toUpperCase() === 'EPSG:3857') ||
    uniqueCrs[0] ||
    'EPSG:4326'

  const outputFormat = pickWfsOutputFormat(
    ft.outputFormats?.length ? ft.outputFormats : description.wfsOutputFormats,
    selection.outputFormat
  )
  if (outputFormat.kind === 'other') {
    return {
      ok: false,
      reason: `不支持的输出格式: ${outputFormat.value}（需要 GeoJSON 或 GML）`
    }
  }

  const extentMode = selection.extentMode ?? 'view'
  let queryExtentWgs84: [number, number, number, number] | undefined
  if (extentMode === 'view') {
    if (!selection.viewExtentWgs84) {
      return { ok: false, reason: '当前视图范围不可用，请改用全范围或等待地图就绪' }
    }
    queryExtentWgs84 = selection.viewExtentWgs84
  } else {
    queryExtentWgs84 = ft.bboxWgs84
  }

  const maxFeatures = clampWfsMaxFeatures(selection.maxFeatures)
  const usePaging = Boolean(description.wfsPaging?.supported)
  const getFeatureUrl =
    description.wfsGetFeatureUrls?.[0] || description.shareableUrl

  return {
    ok: true,
    options: {
      typeName: ft.name,
      version,
      getFeatureUrl,
      outputFormat,
      srsName: preferredSrs,
      queryExtentWgs84,
      extentMode,
      maxFeatures,
      usePaging,
      availableCrs: uniqueCrs
    }
  }
}

export interface BuildGetFeaturePageParams {
  baseUrl: string
  version: string
  typeName: string
  outputFormat: string
  srsName: string
  /** 这次请求还想要的要素数量，对应 count 或 maxFeatures。 */
  pageSize: number
  /** 翻页时从 0 开始的起始索引。 */
  startIndex?: number
  /**
   * 查询包围盒，使用 WGS84 的经度、纬度 [西,南,东,北]。
   * 按版本和 srsName 对应的坐标轴顺序编码（见测试）。
   */
  bboxWgs84?: [number, number, number, number]
  extraParams?: Record<string, string>
}

/**
 * srsName 是地理坐标 EPSG:4326 时，BBOX 的坐标轴顺序：
 * - WFS 2.0 加裸写的 EPSG:4326：经度,纬度（GeoServer 与常见 KVP 做法，已用样例验证）
 * - WFS 1.1 加 urn:ogc:def:crs:EPSG::4326：纬度,经度（OGC 06-121）
 * - 投影后的 EPSG:3857：easting,northing
 *
 * 输出是 GeoJSON 时，几何一律按 RFC 7946 采用经度、纬度顺序；
 * BBOX 的坐标轴顺序仍然遵循上面请求里 srsName 的规则。
 */
export function bboxParamForWfs(options: {
  version: string
  srsName: string
  bboxWgs84: [number, number, number, number]
}): string {
  const [west, south, east, north] = options.bboxWgs84
  const crs = normalizeWfsCrs(options.srsName)?.toUpperCase() || options.srsName.toUpperCase()
  const is4326 = crs === 'EPSG:4326'
  const is11 = options.version.startsWith('1.1')
  const usesUrn = /urn:ogc:def:crs:EPSG::4326/i.test(options.srsName)

  let coords: [number, number, number, number]
  if (is4326 && (is11 || usesUrn)) {
    // 纬度,经度 的顺序
    coords = [south, west, north, east]
  } else {
    // 经度,纬度，或投影坐标
    coords = [west, south, east, north]
  }

  const crsSuffix = options.version.startsWith('2.')
    ? `,${options.srsName}`
    : ''
  return `${coords.join(',')}${crsSuffix}`
}

/** 构造一个 GetFeature 的 KVP URL，永远不嵌入认证密钥。 */
export function buildGetFeatureRequestUrl(params: BuildGetFeaturePageParams): string {
  const url = new URL(params.baseUrl)
  url.searchParams.set('SERVICE', 'WFS')
  url.searchParams.set('REQUEST', 'GetFeature')
  url.searchParams.set('VERSION', params.version)

  const is20 = params.version.startsWith('2.')
  if (is20) {
    url.searchParams.set('TYPENAMES', params.typeName)
    url.searchParams.set('COUNT', String(params.pageSize))
    if (params.startIndex !== undefined && params.startIndex > 0) {
      url.searchParams.set('STARTINDEX', String(params.startIndex))
    }
  } else {
    url.searchParams.set('TYPENAME', params.typeName)
    url.searchParams.set('MAXFEATURES', String(params.pageSize))
    if (params.startIndex !== undefined && params.startIndex > 0) {
      // 只在 Capabilities 公布了翻页能力时使用；1.1 里并不通用。
      url.searchParams.set('STARTINDEX', String(params.startIndex))
    }
  }

  url.searchParams.set('OUTPUTFORMAT', params.outputFormat)
  url.searchParams.set('SRSNAME', params.srsName)

  if (params.bboxWgs84) {
    url.searchParams.set(
      'BBOX',
      bboxParamForWfs({
        version: params.version,
        srsName: params.srsName,
        bboxWgs84: params.bboxWgs84
      })
    )
  }

  if (params.extraParams) {
    for (const [key, value] of Object.entries(params.extraParams)) {
      url.searchParams.set(key, value)
    }
  }

  return url.toString()
}
