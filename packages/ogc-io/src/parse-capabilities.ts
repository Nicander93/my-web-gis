import { OgcError } from './errors.js'
import type { OgcServiceType } from './url.js'
import type {
  ServiceDescription,
  ServiceLayerInfo,
  TileMatrixSetInfo,
  WmtsRequestEncoding,
  WmtsResourceUrl,
  WmtsTileMatrixInfo,
  WmtsTileMatrixSetLink
} from './types.js'
import { child, children, findDeep, parseXmlTree, textOf, type XmlElement } from './xml.js'
import { parseWfsCapabilities } from './parse-wfs.js'

export interface ParseCapabilitiesOptions {
  shareableUrl: string
  /** Hint when auto-detect is ambiguous. */
  hint?: OgcServiceType
}

interface WmsInheritContext {
  crs: string[]
  bboxWgs84?: [number, number, number, number]
}

function detectService(root: XmlElement): OgcServiceType {
  const name = root.name
  if (name.includes('wms') || name === 'wmt_ms_capabilities') return 'WMS'
  if (name.includes('wmts')) return 'WMTS'
  if (name.includes('wfs')) return 'WFS'
  if (name.includes('serviceexception')) {
    throw new OgcError('service-exception', '响应为 ServiceExceptionReport，而非 Capabilities')
  }
  if (findDeep(root, 'capability') && findDeep(root, 'request')) {
    if (findDeep(root, 'layer')) return 'WMS'
  }
  if (findDeep(root, 'contents') && findDeep(root, 'tilematrixset')) return 'WMTS'
  if (findDeep(root, 'featuretypelist') || findDeep(root, 'featuretype')) return 'WFS'
  throw new OgcError('unsupported', `无法识别的 Capabilities 根元素: ${root.name}`)
}

function readWmsBbox(layerEl: XmlElement): [number, number, number, number] | undefined {
  const bboxEl =
    child(layerEl, 'ex_geographicboundingbox') ??
    child(layerEl, 'latlonboundingbox') ??
    child(layerEl, 'geographicboundingbox')
  if (!bboxEl) return undefined
  const west = Number(
    textOf(child(bboxEl, 'westboundlongitude')) || bboxEl.attrs.minx || bboxEl.attrs.westboundlongitude
  )
  const east = Number(
    textOf(child(bboxEl, 'eastboundlongitude')) || bboxEl.attrs.maxx || bboxEl.attrs.eastboundlongitude
  )
  const south = Number(
    textOf(child(bboxEl, 'southboundlatitude')) || bboxEl.attrs.miny || bboxEl.attrs.southboundlatitude
  )
  const north = Number(
    textOf(child(bboxEl, 'northboundlatitude')) || bboxEl.attrs.maxy || bboxEl.attrs.northboundlatitude
  )
  if (![west, south, east, north].every((n) => Number.isFinite(n))) return undefined
  return [west, south, east, north]
}

function parseWmsLayers(layerEl: XmlElement, parent: WmsInheritContext = { crs: [] }): ServiceLayerInfo {
  const name = textOf(child(layerEl, 'name'))
  const title = textOf(child(layerEl, 'title')) || undefined
  const abstract = textOf(child(layerEl, 'abstract')) || undefined
  const localCrs = [
    ...children(layerEl, 'crs').map((c) => textOf(c)),
    ...children(layerEl, 'srs').map((c) => textOf(c))
  ].filter(Boolean)
  const crs = localCrs.length ? localCrs : parent.crs.slice()
  const localBbox = readWmsBbox(layerEl)
  const bboxWgs84 = localBbox ?? parent.bboxWgs84
  const styles = children(layerEl, 'style').map((s) => ({
    name: textOf(child(s, 'name')) || 'default',
    title: textOf(child(s, 'title')) || undefined
  }))
  const childCtx: WmsInheritContext = { crs, bboxWgs84 }
  const nested = children(layerEl, 'layer').map((childLayer) => parseWmsLayers(childLayer, childCtx))
  return {
    name,
    title,
    abstract,
    crs: crs.length ? crs : undefined,
    styles: styles.length ? styles : undefined,
    bboxWgs84,
    queryable: Boolean(name) || layerEl.attrs.queryable === '1' || layerEl.attrs.queryable === 'true',
    children: nested.length ? nested : undefined
  }
}

function flattenNamedLayers(layers: ServiceLayerInfo[]): ServiceLayerInfo[] {
  const out: ServiceLayerInfo[] = []
  const walk = (list: ServiceLayerInfo[]) => {
    for (const layer of list) {
      if (layer.name) out.push(layer)
      if (layer.children) walk(layer.children)
    }
  }
  walk(layers)
  return out
}

function parseWms(doc: XmlElement, shareableUrl: string): ServiceDescription {
  const root = doc.children[0] ?? doc
  const version = root.attrs.version || textOf(child(child(root, 'service') ?? root, 'version')) || '1.3.0'
  const service = child(root, 'service')
  const capability = child(root, 'capability')
  const topLayers = capability ? children(capability, 'layer').map((el) => parseWmsLayers(el)) : []
  return {
    service: 'WMS',
    version,
    title: textOf(child(service ?? root, 'title')) || undefined,
    abstract: textOf(child(service ?? root, 'abstract')) || undefined,
    shareableUrl,
    layers: topLayers,
    rawRootLocalName: root.name
  }
}

function parsePair(text: string): [number, number] | undefined {
  const parts = text.trim().split(/\s+/).map(Number)
  if (parts.length < 2 || !parts.every((n) => Number.isFinite(n))) return undefined
  return [parts[0]!, parts[1]!]
}

function readWmtsWgs84Bbox(layerEl: XmlElement): [number, number, number, number] | undefined {
  const box = child(layerEl, 'wgs84boundingbox')
  if (!box) return undefined
  const lower = parsePair(textOf(child(box, 'lowercorner')))
  const upper = parsePair(textOf(child(box, 'uppercorner')))
  if (!lower || !upper) return undefined
  return [lower[0], lower[1], upper[0], upper[1]]
}

function parseTileMatrix(el: XmlElement): WmtsTileMatrixInfo | null {
  const identifier = textOf(child(el, 'identifier'))
  const scaleDenominator = Number(textOf(child(el, 'scaledenominator')))
  const topLeftCorner = parsePair(textOf(child(el, 'topleftcorner')))
  const tileWidth = Number(textOf(child(el, 'tilewidth'))) || 256
  const tileHeight = Number(textOf(child(el, 'tileheight'))) || 256
  if (!identifier || !Number.isFinite(scaleDenominator) || !topLeftCorner) return null
  const matrixWidth = Number(textOf(child(el, 'matrixwidth')))
  const matrixHeight = Number(textOf(child(el, 'matrixheight')))
  return {
    identifier,
    scaleDenominator,
    topLeftCorner,
    tileWidth,
    tileHeight,
    matrixWidth: Number.isFinite(matrixWidth) ? matrixWidth : undefined,
    matrixHeight: Number.isFinite(matrixHeight) ? matrixHeight : undefined
  }
}

function parseTileMatrixSetLink(linkEl: XmlElement): WmtsTileMatrixSetLink | null {
  const tileMatrixSet = textOf(child(linkEl, 'tilematrixset'))
  if (!tileMatrixSet) return null
  const limitsEl = child(linkEl, 'tilematrixsetlimits')
  const limits = limitsEl
    ? children(limitsEl, 'tilematrixlimits')
        .map((lim) => {
          const tileMatrix = textOf(child(lim, 'tilematrix'))
          const minTileRow = Number(textOf(child(lim, 'mintilerow')))
          const maxTileRow = Number(textOf(child(lim, 'maxtilerow')))
          const minTileCol = Number(textOf(child(lim, 'mintilecol')))
          const maxTileCol = Number(textOf(child(lim, 'maxtilecol')))
          if (
            !tileMatrix ||
            ![minTileRow, maxTileRow, minTileCol, maxTileCol].every((n) => Number.isFinite(n))
          ) {
            return null
          }
          return { tileMatrix, minTileRow, maxTileRow, minTileCol, maxTileCol }
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
    : undefined
  return { tileMatrixSet, limits: limits?.length ? limits : undefined }
}

function parseResourceUrl(el: XmlElement): WmtsResourceUrl | null {
  const template = el.attrs.template || textOf(el)
  const format = el.attrs.format || ''
  const resourceType = el.attrs.resourcetype || ''
  if (!template) return null
  return { format, resourceType, template }
}

function readAttrHref(el: XmlElement): string {
  return el.attrs.href || el.attrs['xlink:href'] || ''
}

function parseWmtsOperations(root: XmlElement): {
  getTileUrls: string[]
  encodings: WmtsRequestEncoding[]
} {
  const ops = findDeep(root, 'operationsmetadata')
  const getTileUrls: string[] = []
  const encodings = new Set<WmtsRequestEncoding>()
  if (!ops) return { getTileUrls, encodings: [] }

  for (const op of children(ops, 'operation')) {
    if ((op.attrs.name || '').toLowerCase() !== 'gettile') continue
    const gets: XmlElement[] = []
    const walk = (el: XmlElement) => {
      if (el.name === 'get') gets.push(el)
      for (const c of el.children) walk(c)
    }
    walk(op)
    for (const getEl of gets) {
      const href = readAttrHref(getEl)
      const constraint = children(getEl, 'constraint').find(
        (c) => (c.attrs.name || '').toLowerCase() === 'getencoding'
      )
      const values = constraint
        ? children(findDeep(constraint, 'allowedvalues') ?? constraint, 'value').map((v) =>
            textOf(v).toUpperCase()
          )
        : []
      if (values.includes('KVP') || values.length === 0) {
        if (href) getTileUrls.push(href)
        encodings.add('KVP')
      }
      if (values.includes('REST')) encodings.add('REST')
    }
  }
  return { getTileUrls, encodings: [...encodings] }
}

function parseWmts(doc: XmlElement, shareableUrl: string): ServiceDescription {
  const root = doc.children[0] ?? doc
  const version = root.attrs.version || '1.0.0'
  const contents = findDeep(root, 'contents') ?? root
  const layers: ServiceLayerInfo[] = children(contents, 'layer').map((layerEl) => {
    const identifier = textOf(child(layerEl, 'identifier')) || textOf(child(layerEl, 'name'))
    const styles = children(layerEl, 'style').map((s) => ({
      name: textOf(child(s, 'identifier')) || textOf(child(s, 'name')) || 'default',
      title: textOf(child(s, 'title')) || undefined,
      isDefault: s.attrs.isdefault === 'true'
    }))
    const formats = children(layerEl, 'format').map((f) => textOf(f)).filter(Boolean)
    const tileMatrixSetLinks = children(layerEl, 'tilematrixsetlink')
      .map(parseTileMatrixSetLink)
      .filter((x): x is WmtsTileMatrixSetLink => Boolean(x))
    const resourceUrls = children(layerEl, 'resourceurl')
      .map(parseResourceUrl)
      .filter((x): x is WmtsResourceUrl => Boolean(x))
    return {
      name: identifier,
      title: textOf(child(layerEl, 'title')) || undefined,
      abstract: textOf(child(layerEl, 'abstract')) || undefined,
      styles: styles.length ? styles : undefined,
      formats: formats.length ? formats : undefined,
      tileMatrixSetLinks: tileMatrixSetLinks.length ? tileMatrixSetLinks : undefined,
      resourceUrls: resourceUrls.length ? resourceUrls : undefined,
      // Keep crs as linked TMS ids for backward-compatible catalog display.
      crs: tileMatrixSetLinks.map((l) => l.tileMatrixSet),
      bboxWgs84: readWmtsWgs84Bbox(layerEl),
      queryable: Boolean(identifier)
    }
  })

  const tileMatrixSets: TileMatrixSetInfo[] = children(contents, 'tilematrixset').map((tms) => ({
    identifier: textOf(child(tms, 'identifier')) || textOf(child(tms, 'name')),
    supportedCrs: textOf(child(tms, 'supportedcrs')) || undefined,
    tileMatrices: children(tms, 'tilematrix')
      .map(parseTileMatrix)
      .filter((x): x is WmtsTileMatrixInfo => Boolean(x))
  }))

  const { getTileUrls, encodings } = parseWmtsOperations(root)
  const hasRestTemplates = layers.some((l) =>
    l.resourceUrls?.some((r) => r.resourceType.toLowerCase() === 'tile' || !r.resourceType)
  )
  const wmtsRequestEncodings: WmtsRequestEncoding[] = []
  for (const enc of encodings) {
    if (!wmtsRequestEncodings.includes(enc)) wmtsRequestEncodings.push(enc)
  }
  if (hasRestTemplates && !wmtsRequestEncodings.includes('REST')) {
    wmtsRequestEncodings.push('REST')
  }
  if (getTileUrls.length && !wmtsRequestEncodings.includes('KVP')) {
    wmtsRequestEncodings.push('KVP')
  }
  // Default assumption when OperationsMetadata omitted but shareable URL exists: KVP.
  if (!wmtsRequestEncodings.length) {
    wmtsRequestEncodings.push(hasRestTemplates ? 'REST' : 'KVP')
  }

  const identification = findDeep(root, 'serviceidentification')
  return {
    service: 'WMTS',
    version,
    title: textOf(child(identification ?? root, 'title')) || textOf(findDeep(root, 'title')) || undefined,
    shareableUrl,
    layers,
    tileMatrixSets,
    wmtsGetTileUrls: getTileUrls.length ? getTileUrls : undefined,
    wmtsRequestEncodings,
    rawRootLocalName: root.name
  }
}

function parseWfs(doc: XmlElement, shareableUrl: string): ServiceDescription {
  return parseWfsCapabilities(doc, shareableUrl)
}

function throwIfServiceException(root: XmlElement): void {
  const local = root.name
  if (!local.includes('serviceexception')) return
  const exceptionEl =
    findDeep(root, 'serviceexception') ??
    (local === 'serviceexception' ? root : undefined)
  const code = exceptionEl?.attrs.code
  const text = exceptionEl ? textOf(exceptionEl).trim() : textOf(root).trim()
  const message = [code, text].filter(Boolean).join(': ') || 'ServiceExceptionReport'
  throw new OgcError('service-exception', message)
}

/**
 * Parse Capabilities XML into a service description.
 * Does not fetch; does not mutate project state.
 */
export function parseCapabilitiesXml(
  xml: string,
  options: ParseCapabilitiesOptions
): ServiceDescription {
  const trimmed = xml.trim()
  if (!trimmed) throw new OgcError('parse', '空文档')
  if (/^<!doctype html|^<html/i.test(trimmed)) {
    throw new OgcError('html-error', '文档为 HTML')
  }

  let tree: XmlElement
  try {
    tree = parseXmlTree(trimmed)
  } catch (err) {
    throw new OgcError('parse', err instanceof Error ? err.message : String(err))
  }

  const rootEl = tree.children[0]
  if (!rootEl) throw new OgcError('parse', '缺少根元素')

  throwIfServiceException(rootEl)

  const service = options.hint ?? detectService(rootEl)
  switch (service) {
    case 'WMS':
      return parseWms(tree, options.shareableUrl)
    case 'WMTS':
      return parseWmts(tree, options.shareableUrl)
    case 'WFS':
      return parseWfs(tree, options.shareableUrl)
    default:
      throw new OgcError('unsupported', `不支持的服务类型: ${service}`)
  }
}

/** Named (requestable) layers only — for connection UI selection lists. */
export function listSelectableLayers(description: ServiceDescription): ServiceLayerInfo[] {
  if (description.service === 'WMS') return flattenNamedLayers(description.layers)
  return description.layers.filter((l) => Boolean(l.name))
}
