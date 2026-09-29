import type {
  ServiceDescription,
  ServiceLayerInfo,
  TileMatrixSetInfo,
  WmtsRequestEncoding,
  WmtsTileMatrixInfo
} from './types.js'

export interface ResolveWmtsSelection {
  layer: string
  style?: string
  format?: string
  tileMatrixSet?: string
  requestEncoding?: WmtsRequestEncoding
  /** Preferred CRS when choosing among linked TileMatrixSets (e.g. EPSG:3857). */
  preferredCrs?: string
}

export interface ResolvedWmtsLayerOptions {
  layer: string
  style: string
  format: string
  tileMatrixSet: string
  requestEncoding: WmtsRequestEncoding
  /** KVP base URL(s) or REST templates — never include auth credentials. */
  urls: string[]
  /** Normalized CRS code when possible (EPSG:3857). */
  projection: string
  /** Raw SupportedCRS from TileMatrixSet. */
  supportedCrs: string
  bboxWgs84?: [number, number, number, number]
  tileMatrices: WmtsTileMatrixInfo[]
}

export type ResolveWmtsResult =
  | { ok: true; options: ResolvedWmtsLayerOptions }
  | { ok: false; reason: string }

/** Normalize urn:ogc:def:crs:EPSG::3857 → EPSG:3857 when possible. */
export function normalizeCrsCode(crs: string | undefined): string | undefined {
  if (!crs) return undefined
  const trimmed = crs.trim()
  const urn = /urn:ogc:def:crs:EPSG::(\d+)/i.exec(trimmed)
  if (urn) return `EPSG:${urn[1]}`
  const epsg = /EPSG[:\s]*(\d+)/i.exec(trimmed)
  if (epsg) return `EPSG:${epsg[1]}`
  return trimmed
}

function crsCompatible(a: string | undefined, b: string | undefined): boolean {
  const na = normalizeCrsCode(a)
  const nb = normalizeCrsCode(b)
  if (!na || !nb) return false
  return na.toUpperCase() === nb.toUpperCase()
}

/** Known mapable projections for this phase (same set as project defaults). */
export function isSupportedWmtsProjection(crs: string | undefined): boolean {
  const code = normalizeCrsCode(crs)?.toUpperCase()
  return code === 'EPSG:3857' || code === 'EPSG:4326'
}

function pickDefaultStyle(layer: ServiceLayerInfo): string {
  const def = layer.styles?.find((s) => s.isDefault) ?? layer.styles?.[0]
  return def?.name || 'default'
}

function pickDefaultFormat(layer: ServiceLayerInfo, encoding: WmtsRequestEncoding): string {
  if (encoding === 'REST') {
    const tile = layer.resourceUrls?.find(
      (r) => !r.resourceType || r.resourceType.toLowerCase() === 'tile'
    )
    if (tile?.format) return tile.format
  }
  return (
    layer.formats?.find((f) => /png/i.test(f)) ||
    layer.formats?.[0] ||
    'image/png'
  )
}

function listLinkedMatrixSets(
  layer: ServiceLayerInfo,
  sets: TileMatrixSetInfo[]
): TileMatrixSetInfo[] {
  const byId = new Map(sets.map((s) => [s.identifier, s]))
  const linkedIds =
    layer.tileMatrixSetLinks?.map((l) => l.tileMatrixSet) ??
    layer.crs ??
    []
  const out: TileMatrixSetInfo[] = []
  for (const id of linkedIds) {
    const set = byId.get(id)
    if (set) out.push(set)
  }
  return out
}

/**
 * List TileMatrixSets linked to a layer that have usable matrix definitions.
 * Does not invent XYZ / numeric zoom grids.
 */
export function listCompatibleTileMatrixSets(
  description: ServiceDescription,
  layerName: string
): Array<TileMatrixSetInfo & { compatible: boolean; reason?: string }> {
  const layer = description.layers.find((l) => l.name === layerName)
  if (!layer) return []
  const sets = description.tileMatrixSets ?? []
  const linked = listLinkedMatrixSets(layer, sets)
  return linked.map((set) => {
    if (!set.tileMatrices?.length) {
      return { ...set, compatible: false, reason: `TileMatrixSet "${set.identifier}" 缺少 TileMatrix 定义` }
    }
    if (!isSupportedWmtsProjection(set.supportedCrs)) {
      return {
        ...set,
        compatible: false,
        reason: `不支持的投影 ${set.supportedCrs || '（未声明）'}；本阶段仅支持 EPSG:3857 / EPSG:4326`
      }
    }
    const incomplete = set.tileMatrices.some(
      (m) =>
        !m.identifier ||
        !Number.isFinite(m.scaleDenominator) ||
        !m.topLeftCorner ||
        !m.tileWidth ||
        !m.tileHeight
    )
    if (incomplete) {
      return {
        ...set,
        compatible: false,
        reason: `TileMatrixSet "${set.identifier}" 的矩阵缺少 origin / scaleDenominator / tile size`
      }
    }
    return { ...set, compatible: true }
  })
}

function pickTileMatrixSet(
  description: ServiceDescription,
  layer: ServiceLayerInfo,
  requested: string | undefined,
  preferredCrs: string | undefined
): { ok: true; set: TileMatrixSetInfo } | { ok: false; reason: string } {
  const compatible = listCompatibleTileMatrixSets(description, layer.name)
  if (requested) {
    const found = compatible.find((s) => s.identifier === requested)
    if (!found) {
      return {
        ok: false,
        reason: `图层 "${layer.name}" 未链接 TileMatrixSet "${requested}"，不会改用其他矩阵`
      }
    }
    if (!found.compatible) {
      return { ok: false, reason: found.reason || `TileMatrixSet "${requested}" 不可用` }
    }
    return { ok: true, set: found }
  }

  const usable = compatible.filter((s) => s.compatible)
  if (!usable.length) {
    const reasons = compatible.map((s) => s.reason).filter(Boolean)
    return {
      ok: false,
      reason:
        reasons[0] ||
        `图层 "${layer.name}" 没有可用的 TileMatrixSet（缺少矩阵或不兼容投影）`
    }
  }

  if (preferredCrs) {
    const match = usable.find((s) => crsCompatible(s.supportedCrs, preferredCrs))
    if (match) return { ok: true, set: match }
  }
  const webMerc = usable.find((s) => crsCompatible(s.supportedCrs, 'EPSG:3857'))
  return { ok: true, set: webMerc ?? usable[0]! }
}

function pickEncoding(
  description: ServiceDescription,
  layer: ServiceLayerInfo,
  requested?: WmtsRequestEncoding
): { ok: true; encoding: WmtsRequestEncoding } | { ok: false; reason: string } {
  const hasRest = Boolean(
    layer.resourceUrls?.some(
      (r) => !r.resourceType || r.resourceType.toLowerCase() === 'tile'
    )
  )
  const hasKvpOps = Boolean(description.wmtsGetTileUrls?.length)
  const advertised = description.wmtsRequestEncodings ?? []
  const available = new Set<WmtsRequestEncoding>(advertised)
  if (hasRest) available.add('REST')
  if (hasKvpOps || advertised.includes('KVP')) available.add('KVP')
  // Shareable URL alone is a KVP fallback only when REST is not the sole path.
  const canKvpFallback = Boolean(description.shareableUrl) && !hasRest
  if (canKvpFallback) available.add('KVP')

  if (requested) {
    if (requested === 'REST' && !hasRest) {
      return { ok: false, reason: '图层未提供 REST ResourceURL 模板' }
    }
    if (requested === 'KVP' && !hasKvpOps && !description.shareableUrl) {
      return { ok: false, reason: '缺少 KVP GetTile 端点' }
    }
    if (!available.has(requested) && !(requested === 'KVP' && description.shareableUrl)) {
      return {
        ok: false,
        reason: `服务未声明 ${requested} 请求编码（可用: ${[...available].join(', ') || '无'}）`
      }
    }
    return { ok: true, encoding: requested }
  }

  // Prefer advertised order when present (REST-only fixtures default to REST).
  for (const enc of advertised) {
    if (enc === 'REST' && hasRest) return { ok: true, encoding: 'REST' }
    if (enc === 'KVP' && (hasKvpOps || description.shareableUrl)) {
      return { ok: true, encoding: 'KVP' }
    }
  }
  if (hasKvpOps) return { ok: true, encoding: 'KVP' }
  if (hasRest) return { ok: true, encoding: 'REST' }
  if (description.shareableUrl) return { ok: true, encoding: 'KVP' }
  return { ok: false, reason: 'Capabilities 未声明 KVP GetTile 或 REST ResourceURL' }
}

function buildUrls(
  description: ServiceDescription,
  layer: ServiceLayerInfo,
  encoding: WmtsRequestEncoding,
  format: string
): string[] {
  if (encoding === 'REST') {
    const templates = (layer.resourceUrls ?? [])
      .filter((r) => !r.resourceType || r.resourceType.toLowerCase() === 'tile')
      .filter((r) => !format || !r.format || r.format === format)
      .map((r) => r.template)
    if (templates.length) return templates
    return (layer.resourceUrls ?? [])
      .filter((r) => !r.resourceType || r.resourceType.toLowerCase() === 'tile')
      .map((r) => r.template)
  }
  if (description.wmtsGetTileUrls?.length) return description.wmtsGetTileUrls.slice()
  // Fall back to shareable capabilities base (KVP GetTile on same endpoint).
  return [description.shareableUrl]
}

/**
 * Resolve layer/style/format/TileMatrixSet/encoding into concrete options.
 * Never silently substitutes an unlinked or incomplete matrix set.
 */
export function resolveWmtsLayerOptions(
  description: ServiceDescription,
  selection: ResolveWmtsSelection
): ResolveWmtsResult {
  if (description.service !== 'WMTS') {
    return { ok: false, reason: '当前 Capabilities 不是 WMTS' }
  }
  const layer = description.layers.find((l) => l.name === selection.layer)
  if (!layer) {
    return { ok: false, reason: `找不到图层 "${selection.layer}"` }
  }

  const encodingResult = pickEncoding(description, layer, selection.requestEncoding)
  if (!encodingResult.ok) return encodingResult

  const style =
    selection.style ||
    (layer.styles?.some((s) => s.name === selection.style) ? selection.style : undefined) ||
    pickDefaultStyle(layer)
  if (selection.style && !layer.styles?.some((s) => s.name === selection.style)) {
    // Allow explicit style even if not listed (some servers omit Style list); warn via reason only when empty styles claimed otherwise.
  }

  const format = selection.format || pickDefaultFormat(layer, encodingResult.encoding)
  if (
    selection.format &&
    layer.formats?.length &&
    !layer.formats.includes(selection.format) &&
    encodingResult.encoding === 'KVP'
  ) {
    return {
      ok: false,
      reason: `图层不支持格式 "${selection.format}"（可用: ${layer.formats.join(', ')}）`
    }
  }

  const tms = pickTileMatrixSet(
    description,
    layer,
    selection.tileMatrixSet,
    selection.preferredCrs
  )
  if (!tms.ok) return tms

  const urls = buildUrls(description, layer, encodingResult.encoding, format)
  if (!urls.length) {
    return { ok: false, reason: '无法确定瓦片请求 URL / 模板（与认证凭据分开，模板不含 Token）' }
  }

  const projection = normalizeCrsCode(tms.set.supportedCrs) || tms.set.supportedCrs || ''
  if (!isSupportedWmtsProjection(projection)) {
    return {
      ok: false,
      reason: `不兼容投影 "${tms.set.supportedCrs}"，不会改用其他矩阵`
    }
  }

  return {
    ok: true,
    options: {
      layer: layer.name,
      style,
      format,
      tileMatrixSet: tms.set.identifier,
      requestEncoding: encodingResult.encoding,
      urls,
      projection,
      supportedCrs: tms.set.supportedCrs || projection,
      bboxWgs84: layer.bboxWgs84,
      tileMatrices: (tms.set.tileMatrices ?? []).map((m) => ({ ...m, topLeftCorner: [...m.topLeftCorner] as [number, number] }))
    }
  }
}

/** WMTS 1.0.0 standardized pixel size (meters): 0.28 mm. */
export const WMTS_PIXEL_SIZE_METERS = 0.00028

/**
 * Compute map resolution for a TileMatrix ScaleDenominator.
 * metersPerUnit is 1 for projected meters (EPSG:3857); for EPSG:4326 use projection meters-per-degree.
 */
export function resolutionFromScaleDenominator(
  scaleDenominator: number,
  metersPerUnit: number
): number {
  return (scaleDenominator * WMTS_PIXEL_SIZE_METERS) / metersPerUnit
}
