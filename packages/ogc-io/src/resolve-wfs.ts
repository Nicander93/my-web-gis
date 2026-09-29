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
  /** Preferred output format value; resolved against advertised list. */
  outputFormat?: string
  srsName?: string
  maxFeatures?: number
  extentMode?: WfsExtentMode
  /** Current map view in WGS84 [west,south,east,north] when extentMode=view. */
  viewExtentWgs84?: [number, number, number, number]
}

export interface ResolvedWfsLoadOptions {
  typeName: string
  version: string
  /** Shareable GetFeature base URL (no secrets). */
  getFeatureUrl: string
  outputFormat: WfsResolvedOutputFormat
  srsName: string
  /** BBOX in WGS84 lon/lat order for internal bookkeeping. */
  queryExtentWgs84?: [number, number, number, number]
  extentMode: WfsExtentMode
  maxFeatures: number
  /** Whether to attempt startIndex pagination. */
  usePaging: boolean
  /** Feature-type advertised CRS list (default first). */
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
 * Prefer GeoJSON; else a supported GML path; else first advertised / safe default.
 */
export function pickWfsOutputFormat(
  advertised: string[] | undefined,
  preferred?: string
): WfsResolvedOutputFormat {
  const list = (advertised ?? []).map((v) => v.trim()).filter(Boolean)
  if (preferred) {
    const hit = list.find((v) => v.toLowerCase() === preferred.toLowerCase())
    if (hit) return { value: hit, kind: classifyOutputFormat(hit) }
    // Caller override even if not listed (some servers omit OutputFormat enum).
    return { value: preferred, kind: classifyOutputFormat(preferred) }
  }
  const geo = list.find((v) => classifyOutputFormat(v) === 'geojson')
  if (geo) return { value: geo, kind: 'geojson' }
  const gml = list.find((v) => classifyOutputFormat(v) === 'gml')
  if (gml) return { value: gml, kind: 'gml' }
  if (list[0]) return { value: list[0], kind: classifyOutputFormat(list[0]) }
  // Common GeoServer default when capabilities omit the list.
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
 * Resolve WFS load options from capabilities + user selection.
 * Does not fetch; does not mutate project state.
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
  /** Remaining features wanted for this request (count / maxFeatures). */
  pageSize: number
  /** 0-based start index when paging. */
  startIndex?: number
  /**
   * Query bbox in WGS84 lon/lat [west,south,east,north].
   * Encoded with axis order appropriate for version + srsName (see tests).
   */
  bboxWgs84?: [number, number, number, number]
  extraParams?: Record<string, string>
}

/**
 * Axis order for BBOX when srsName is geographic EPSG:4326:
 * - WFS 2.0 + bare EPSG:4326: lon,lat (GeoServer / common KVP practice; sample-validated)
 * - WFS 1.1 + urn:ogc:def:crs:EPSG::4326: lat,lon (OGC 06-121)
 * - Projected EPSG:3857: easting,northing
 *
 * When output is GeoJSON, geometries are always lon,lat per RFC 7946;
 * BBOX axis still follows the request srsName rules above.
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
    // lat,lon order
    coords = [south, west, north, east]
  } else {
    // lon,lat or projected
    coords = [west, south, east, north]
  }

  const crsSuffix = options.version.startsWith('2.')
    ? `,${options.srsName}`
    : ''
  return `${coords.join(',')}${crsSuffix}`
}

/** Build one GetFeature KVP URL. Never embeds auth secrets. */
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
      // Only used when capabilities advertised paging; non-universal for 1.1.
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
