import { OgcError } from './errors.js'
import type { OgcServiceType } from './url.js'
import type { ServiceDescription, ServiceLayerInfo, TileMatrixSetInfo } from './types.js'
import { child, children, findDeep, parseXmlTree, textOf, type XmlElement } from './xml.js'

export interface ParseCapabilitiesOptions {
  shareableUrl: string
  /** Hint when auto-detect is ambiguous. */
  hint?: OgcServiceType
}

function detectService(root: XmlElement): OgcServiceType {
  const name = root.name
  if (name.includes('wms') || name === 'wmt_ms_capabilities') return 'WMS'
  if (name.includes('wmts')) return 'WMTS'
  if (name.includes('wfs')) return 'WFS'
  // Caps root wrappers
  if (findDeep(root, 'capability') && findDeep(root, 'request')) {
    // WMS 1.x often WMS_Capabilities / WMT_MS_Capabilities
    if (findDeep(root, 'layer')) return 'WMS'
  }
  if (findDeep(root, 'contents') && findDeep(root, 'tilematrixset')) return 'WMTS'
  if (findDeep(root, 'featuretypelist') || findDeep(root, 'featuretype')) return 'WFS'
  throw new OgcError('unsupported', `无法识别的 Capabilities 根元素: ${root.name}`)
}

function parseWmsLayers(layerEl: XmlElement): ServiceLayerInfo {
  const name = textOf(child(layerEl, 'name'))
  const title = textOf(child(layerEl, 'title')) || undefined
  const abstract = textOf(child(layerEl, 'abstract')) || undefined
  const crs = [
    ...children(layerEl, 'crs').map((c) => textOf(c)),
    ...children(layerEl, 'srs').map((c) => textOf(c))
  ].filter(Boolean)
  const styles = children(layerEl, 'style').map((s) => ({
    name: textOf(child(s, 'name')) || 'default',
    title: textOf(child(s, 'title')) || undefined
  }))
  const bboxEl =
    child(layerEl, 'ex_geographicboundingbox') ??
    child(layerEl, 'latlonboundingbox') ??
    child(layerEl, 'geographicboundingbox')
  let bboxWgs84: [number, number, number, number] | undefined
  if (bboxEl) {
    const west = Number(textOf(child(bboxEl, 'westboundlongitude')) || bboxEl.attrs.minx || bboxEl.attrs.westboundlongitude)
    const east = Number(textOf(child(bboxEl, 'eastboundlongitude')) || bboxEl.attrs.maxx || bboxEl.attrs.eastboundlongitude)
    const south = Number(textOf(child(bboxEl, 'southboundlatitude')) || bboxEl.attrs.miny || bboxEl.attrs.southboundlatitude)
    const north = Number(textOf(child(bboxEl, 'northboundlatitude')) || bboxEl.attrs.maxy || bboxEl.attrs.northboundlatitude)
    if ([west, south, east, north].every((n) => Number.isFinite(n))) {
      bboxWgs84 = [west, south, east, north]
    }
  }
  const nested = children(layerEl, 'layer').map(parseWmsLayers)
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
  const topLayers = capability ? children(capability, 'layer').map(parseWmsLayers) : []
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

function parseWmts(doc: XmlElement, shareableUrl: string): ServiceDescription {
  const root = doc.children[0] ?? doc
  const version = root.attrs.version || '1.0.0'
  const contents = findDeep(root, 'contents') ?? root
  const layers: ServiceLayerInfo[] = children(contents, 'layer').map((layerEl) => {
    const identifier = textOf(child(layerEl, 'identifier')) || textOf(child(layerEl, 'name'))
    const styles = children(layerEl, 'style').map((s) => ({
      name: textOf(child(s, 'identifier')) || textOf(child(s, 'name')) || 'default',
      title: textOf(child(s, 'title')) || undefined
    }))
    const formats = children(layerEl, 'format').map((f) => textOf(f)).filter(Boolean)
    const tmsLinks = children(layerEl, 'tilematrixsetlink').map((link) =>
      textOf(child(link, 'tilematrixset'))
    )
    return {
      name: identifier,
      title: textOf(child(layerEl, 'title')) || undefined,
      abstract: textOf(child(layerEl, 'abstract')) || undefined,
      styles: styles.length ? styles : undefined,
      crs: tmsLinks.filter(Boolean),
      queryable: Boolean(identifier),
      // stash format in abstract-adjacent via styles empty — keep on layer via title note
      children: formats.length
        ? formats.map((f) => ({ name: f, title: 'format' }))
        : undefined
    }
  })

  const tileMatrixSets: TileMatrixSetInfo[] = children(contents, 'tilematrixset').map((tms) => ({
    identifier: textOf(child(tms, 'identifier')) || textOf(child(tms, 'name')),
    supportedCrs: textOf(child(tms, 'supportedcrs')) || undefined,
    tileMatrices: children(tms, 'tilematrix').map((tm) => ({
      identifier: textOf(child(tm, 'identifier')),
      scaleDenominator: Number(textOf(child(tm, 'scaledenominator'))) || undefined
    }))
  }))

  return {
    service: 'WMTS',
    version,
    title: textOf(findDeep(root, 'title')) || undefined,
    shareableUrl,
    layers,
    tileMatrixSets,
    rawRootLocalName: root.name
  }
}

function parseWfs(doc: XmlElement, shareableUrl: string): ServiceDescription {
  const root = doc.children[0] ?? doc
  const version = root.attrs.version || '2.0.0'
  const list = findDeep(root, 'featuretypelist') ?? root
  const featureTypes = children(list, 'featuretype').map((ft) => {
    const name = textOf(child(ft, 'name')) || textOf(child(ft, 'title'))
    const defaultCrs =
      textOf(child(ft, 'defaultcrs')) ||
      textOf(child(ft, 'defaultsrs')) ||
      textOf(child(ft, 'srs'))
    return {
      name,
      title: textOf(child(ft, 'title')) || undefined,
      abstract: textOf(child(ft, 'abstract')) || undefined,
      crs: defaultCrs ? [defaultCrs] : undefined,
      queryable: Boolean(name)
    } satisfies ServiceLayerInfo
  })

  return {
    service: 'WFS',
    version,
    title: textOf(child(findDeep(root, 'serviceidentification') ?? root, 'title')) || undefined,
    shareableUrl,
    layers: featureTypes,
    featureTypes,
    rawRootLocalName: root.name
  }
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