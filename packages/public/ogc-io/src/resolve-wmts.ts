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
  /** 在多个关联的 TileMatrixSet 之间选择时首选的 CRS，例如 EPSG:3857。 */
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
  /** 能规范化时给出 CRS 代码，例如 EPSG:3857。 */
  projection: string
  /** TileMatrixSet 里原始的 SupportedCRS。 */
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

/** 当前阶段已知可映射的投影，与项目默认值一致。 */
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
 * 列出与该图层关联、且有可用矩阵定义的 TileMatrixSet。
 * 不会凭空编造 XYZ 或数字缩放级别的网格。
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
  // 只有在 REST 不是唯一路径时，单独的可分享 URL 才作为 KVP 的回退方案。
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

  // 有公布顺序时按公布顺序（只有 REST 的夹具默认用 REST）。
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
  // 回退到可分享的 Capabilities 基地址，在同一端点上用 KVP 发 GetTile。
  return [description.shareableUrl]
}

/**
 * 把图层、样式、格式、TileMatrixSet 和编码解析成具体的选项。
 * 绝不静默替换成一个没有关联或不完整的矩阵集。
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
    // 即使没有列出来也允许显式指定样式（有些服务会省略 Style 列表）；只有在声称样式为空、实际却不是时才在 reason 里给出提示。
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

/** WMTS 1.0.0 规定的标准像素尺寸（米）：0.28 毫米。 */
export const WMTS_PIXEL_SIZE_METERS = 0.00028

/**
 * 由 TileMatrix 的 ScaleDenominator 计算地图分辨率。
 * metersPerUnit 在投影米（EPSG:3857）下是 1；EPSG:4326 则要用投影的每度米数。
 */
export function resolutionFromScaleDenominator(
  scaleDenominator: number,
  metersPerUnit: number
): number {
  return (scaleDenominator * WMTS_PIXEL_SIZE_METERS) / metersPerUnit
}
