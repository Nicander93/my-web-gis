import type {
  ServiceDescription,
  ServiceLayerInfo
} from './types.js'
import { child, children, findDeep, textOf, type XmlElement } from './xml.js'

function readWfsBbox(ft: XmlElement): [number, number, number, number] | undefined {
  const bboxEl =
    child(ft, 'wgs84boundingbox') ??
    child(ft, 'latlongboundingbox') ??
    findDeep(ft, 'wgs84boundingbox')
  if (!bboxEl) return undefined

  const lower = textOf(child(bboxEl, 'lowercorner')).trim().split(/\s+/)
  const upper = textOf(child(bboxEl, 'uppercorner')).trim().split(/\s+/)
  if (lower.length >= 2 && upper.length >= 2) {
    const w = Number(lower[0])
    const s = Number(lower[1])
    const e = Number(upper[0])
    const n = Number(upper[1])
    if ([w, s, e, n].every((x) => Number.isFinite(x))) return [w, s, e, n]
  }

  const minx = Number(bboxEl.attrs.minx)
  const miny = Number(bboxEl.attrs.miny)
  const maxx = Number(bboxEl.attrs.maxx)
  const maxy = Number(bboxEl.attrs.maxy)
  if ([minx, miny, maxx, maxy].every((x) => Number.isFinite(x))) {
    return [minx, miny, maxx, maxy]
  }
  return undefined
}

function collectNamedParameterValues(
  root: XmlElement,
  operationLocal: string,
  paramLocal: string
): string[] {
  const values: string[] = []
  const opsParent = findDeep(root, 'operationsmetadata') ?? findDeep(root, 'capability') ?? root
  const operations = children(opsParent, 'operation')

  for (const op of operations) {
    const opName = (op.attrs.name || '').toLowerCase()
    if (opName && !opName.includes(operationLocal)) continue

    for (const param of children(op, 'parameter')) {
      const pName = (param.attrs.name || textOf(child(param, 'name')) || '').toLowerCase()
      if (pName !== paramLocal && !pName.includes(paramLocal)) continue
      const walk = (el: XmlElement) => {
        if (el.name === 'value' || el.name === 'defaultvalue') {
          const t = textOf(el).trim()
          if (t) values.push(t)
        }
        for (const c of el.children) walk(c)
      }
      walk(param)
    }
  }
  return [...new Set(values)]
}

function readGetFeatureUrls(root: XmlElement, shareableUrl: string): string[] {
  const urls: string[] = []
  const ops = findDeep(root, 'operationsmetadata')
  if (ops) {
    for (const op of children(ops, 'operation')) {
      if ((op.attrs.name || '').toLowerCase() !== 'getfeature') continue
      for (const dcp of children(op, 'dcp')) {
        for (const http of children(dcp, 'http')) {
          for (const get of children(http, 'get')) {
            const href = get.attrs['xlink:href'] || get.attrs.href
            if (href) urls.push(href.split('?')[0] || href)
          }
        }
      }
    }
  }

  const request = findDeep(root, 'request')
  if (request) {
    const gf = child(request, 'getfeature')
    if (gf) {
      const gets: XmlElement[] = [...children(gf, 'get')]
      const dcp = child(gf, 'dcptype')
      if (dcp) {
        for (const http of children(dcp, 'http')) {
          gets.push(...children(http, 'get'))
        }
      }
      for (const get of gets) {
        const href = get.attrs['xlink:href'] || get.attrs.onlineresource || get.attrs.href
        if (href) urls.push(href.split('?')[0] || href)
      }
    }
  }

  if (!urls.length) urls.push(shareableUrl)
  return [...new Set(urls)]
}

function readWfsPaging(root: XmlElement): { supported: boolean; countDefault?: number } {
  let supported = false
  let countDefault: number | undefined
  const constraints: XmlElement[] = []

  const ops = findDeep(root, 'operationsmetadata')
  if (ops) {
    constraints.push(...children(ops, 'constraint'))
    for (const op of children(ops, 'operation')) {
      if ((op.attrs.name || '').toLowerCase() === 'getfeature') {
        constraints.push(...children(op, 'constraint'))
        for (const param of children(op, 'parameter')) {
          const name = (param.attrs.name || '').toLowerCase()
          if (name === 'startindex' || name === 'count') supported = true
        }
      }
    }
  }

  for (const c of constraints) {
    const name = (c.attrs.name || textOf(child(c, 'name')) || '').toLowerCase()
    if (name === 'implementsresultpaging' || name === 'resultpaging') {
      const valueEl = findDeep(c, 'value')
      const def =
        textOf(child(c, 'defaultvalue')) ||
        (valueEl ? textOf(valueEl) : '') ||
        textOf(c)
      if (/true|1/i.test(def)) supported = true
    }
    if (name === 'countdefault') {
      const def = textOf(child(c, 'defaultvalue')) || textOf(c)
      const n = Number(def)
      if (Number.isFinite(n) && n > 0) countDefault = n
    }
  }

  if (collectNamedParameterValues(root, 'getfeature', 'startindex').length) {
    supported = true
  }

  return { supported, countDefault }
}

/** Parse WFS 2.0 / 1.1 Capabilities into ServiceDescription. */
export function parseWfsCapabilities(doc: XmlElement, shareableUrl: string): ServiceDescription {
  const root = doc.children[0] ?? doc
  const version = root.attrs.version || '2.0.0'
  const list = findDeep(root, 'featuretypelist') ?? root
  const featureTypes = children(list, 'featuretype').map((ft) => {
    const name = textOf(child(ft, 'name')) || textOf(child(ft, 'title'))
    const defaultCrs =
      textOf(child(ft, 'defaultcrs')) ||
      textOf(child(ft, 'defaultsrs')) ||
      textOf(child(ft, 'srs')) ||
      undefined
    const otherCrs = [
      ...children(ft, 'othercrs').map((c) => textOf(c)),
      ...children(ft, 'othersrs').map((c) => textOf(c))
    ].filter(Boolean)
    const crs = [defaultCrs, ...otherCrs].filter(Boolean) as string[]
    const formatsEl = child(ft, 'outputformats')
    const outputFormats = formatsEl
      ? children(formatsEl, 'format').map((f) => textOf(f)).filter(Boolean)
      : undefined
    return {
      name,
      title: textOf(child(ft, 'title')) || undefined,
      abstract: textOf(child(ft, 'abstract')) || undefined,
      defaultCrs: defaultCrs || undefined,
      otherCrs: otherCrs.length ? otherCrs : undefined,
      crs: crs.length ? crs : undefined,
      bboxWgs84: readWfsBbox(ft),
      outputFormats: outputFormats?.length ? outputFormats : undefined,
      queryable: Boolean(name)
    } satisfies ServiceLayerInfo
  })

  const fromOps = collectNamedParameterValues(root, 'getfeature', 'outputformat')
  const request = findDeep(root, 'request')
  const gf = request ? child(request, 'getfeature') : undefined
  const from11: string[] = []
  if (gf) {
    const rf = child(gf, 'resultformat')
    if (rf) {
      for (const c of rf.children) {
        if (c.name && c.name !== 'resultformat') from11.push(c.name)
      }
    }
  }
  const uniqueFormats = [...new Set([...fromOps, ...from11].map((s) => s.trim()).filter(Boolean))]

  return {
    service: 'WFS',
    version,
    title:
      textOf(child(findDeep(root, 'serviceidentification') ?? root, 'title')) || undefined,
    shareableUrl,
    layers: featureTypes,
    featureTypes,
    wfsOutputFormats: uniqueFormats.length ? uniqueFormats : undefined,
    wfsGetFeatureUrls: readGetFeatureUrls(root, shareableUrl),
    wfsPaging: readWfsPaging(root),
    rawRootLocalName: root.name
  }
}
