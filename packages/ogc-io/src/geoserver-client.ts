import { DOMParser } from '@xmldom/xmldom'
import { fingerprintMbStyle } from './mbstyle-export.js'

export interface GeoServerRequest { method: string; headers: Record<string, string>; body?: Uint8Array; signal?: AbortSignal }
export type GeoServerTransport = (url: string, request: GeoServerRequest) => Promise<Response>
export interface RemoteStyle { content: string; hash: string; etag?: string }
export interface MbStyleCapability { supported: boolean; reason: string; moduleName?: string; serverVersion?: string }
export interface PublishStep { step: string; status: 'started' | 'passed' | 'failed'; message?: string }
export interface GeoServerLayer { name: string; defaultStyle?: { name: string; workspace?: string }; resource?: { name: string; href?: string } }
export interface GeoServerFeatureType { name: string; srs?: string; attributes?: { attribute: Array<{ name: string; binding: string }> }; latLonBoundingBox?: { minx: number; miny: number; maxx: number; maxy: number } }
export class GeoServerPublishError extends Error {
  constructor(message: string, readonly steps: readonly PublishStep[]) { super(message); this.name = 'GeoServerPublishError' }
}

function segment(value: string): string {
  if (!value || value.length > 256 || /[\x00-\x1f/\\?#]/.test(value) || value === '.' || value === '..') throw new Error('GeoServer 名称无效')
  return encodeURIComponent(value)
}

/** Fingerprints parsed XML rather than indentation, prefixes or xmlns placement. */
export async function fingerprintSld(content: string): Promise<string> {
  if (content.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error('SLD 声明或大小无效')
  const document = new DOMParser({ onError: (_level, message) => { throw new Error(message) } }).parseFromString(content, 'application/xml')
  const root = document.documentElement
  if (root?.localName !== 'StyledLayerDescriptor' || root.namespaceURI !== 'http://www.opengis.net/sld') throw new Error('需要 SLD StyledLayerDescriptor')
  let count = 0
  function normalized(node: import('@xmldom/xmldom').Node, depth = 0): unknown {
    if (++count > 100000 || depth > 100) throw new Error('SLD 结构过大')
    if (node.nodeType === 3 || node.nodeType === 4) {
      const parent = node.parentNode as import('@xmldom/xmldom').Element | null
      if (parent?.localName === 'Literal' || parent?.localName === 'Label' && !parent.getElementsByTagName('*').length) return node.nodeValue
      return node.nodeValue?.trim() || undefined
    }
    if (node.nodeType !== 1) return undefined
    const element = node as import('@xmldom/xmldom').Element
    const elementChildren = Array.from(element.childNodes).filter(child => child.nodeType === 1) as import('@xmldom/xmldom').Element[]
    const literalContent = !elementChildren.length || elementChildren.length === 1 && elementChildren[0].localName === 'Literal' && elementChildren[0].namespaceURI === 'http://www.opengis.net/ogc'
    if (literalContent && element.namespaceURI === 'http://www.opengis.net/sld' && element.localName === 'CssParameter') {
      const defaults: Record<string, string> = { 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'stroke-opacity': '1', 'stroke-width': '1', 'fill-opacity': '1', 'font-style': 'normal', 'font-weight': 'normal' }
      const name = element.getAttribute('name') ?? '', value = element.textContent?.trim() ?? ''
      if (defaults[name] === value) return undefined
    }
    if (literalContent && element.namespaceURI === 'http://www.opengis.net/sld' && element.localName === 'PerpendicularOffset' && Number(element.textContent) === 0 && (element.parentNode as import('@xmldom/xmldom').Element | null)?.localName === 'LinePlacement') return undefined
    const attributes: string[] = []
    for (let index = 0; index < element.attributes.length; index++) {
      const attribute = element.attributes.item(index)!
      if (attribute.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && !(attribute.namespaceURI === 'http://www.w3.org/2001/XMLSchema-instance' && attribute.localName === 'schemaLocation')) attributes.push(`${attribute.namespaceURI ?? ''}:${attribute.localName}=${attribute.value}`)
    }
    const children: unknown[] = []
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (['CssParameter', 'SvgParameter', 'Label'].includes(element.localName ?? '') && child.nodeType === 1 && (child as import('@xmldom/xmldom').Element).localName === 'Literal' && child.namespaceURI === 'http://www.opengis.net/ogc' && child.childNodes.length === 1) children.push(element.localName === 'Label' ? child.textContent : child.textContent?.trim())
      else { const value = normalized(child, depth + 1); if (value !== undefined) children.push(value) }
    }
    if (['CssParameter', 'SvgParameter'].includes(element.localName ?? '') && children.length === 1 && typeof children[0] === 'string') {
      const name = element.getAttribute('name') ?? ''
      if (['stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'fill-opacity', 'font-size'].includes(name)) {
        const numbers = children[0].trim().split(/[\s,]+/).map(Number)
        if (numbers.every(Number.isFinite)) children[0] = numbers.map(String).join(' ')
      }
    }
    if (['Stroke', 'Fill', 'Font'].includes(element.localName ?? '')) children.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
    if (element.namespaceURI === 'http://www.opengis.net/sld' && ['Size', 'Radius', 'Rotation', 'Opacity', 'AnchorPointX', 'AnchorPointY', 'DisplacementX', 'DisplacementY', 'MinScaleDenominator', 'MaxScaleDenominator'].includes(element.localName ?? '') && children.length === 1 && typeof children[0] === 'string' && Number.isFinite(Number(children[0]))) children[0] = String(Number(Number(children[0]).toPrecision(12)))
    return [element.namespaceURI, element.localName, attributes.sort(), children]
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(normalized(root))))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** No retries: a failed mutation may already have reached GeoServer. */
export function createGeoServerClient(baseUrl: string, transport: GeoServerTransport, timeoutMs = 30000) {
  const base = new URL(baseUrl)
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('连接需要不含账号、查询参数和片段的 HTTP(S) GeoServer 根地址')
  base.pathname = base.pathname.replace(/\/+$/, '') + '/'
  const endpoint = (path: string) => new URL(path, base).href
  async function request(path: string, method = 'GET', body?: Uint8Array, contentType = 'application/json', signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<Response> {
    signal?.throwIfAborted()
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('GeoServer 请求超时')), timeoutMs)
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const response = await transport(endpoint(path), { method, headers: { Accept: method === 'GET' ? '*/*' : 'application/json', ...(body ? { 'Content-Type': contentType } : {}), ...extraHeaders }, body, signal: controller.signal })
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('GeoServer 响应超过 32 MiB')
      return new Response(response.status === 204 || response.status === 304 ? null : bytes, { status: response.status, headers: response.headers })
    }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  async function json<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await request(path, 'GET', undefined, undefined, signal)
    if (!response.ok) throw new Error(`GeoServer 查询失败（HTTP ${response.status}）`)
    return response.json() as Promise<T>
  }
  const stylePath = (workspace: string, name: string, format: 'sld' | 'mbstyle' = 'sld') => `rest/workspaces/${segment(workspace)}/styles/${segment(name)}${format === 'sld' ? '.sld' : ''}`
  async function readRemoteStyle(workspace: string, name: string, format: 'sld' | 'mbstyle', signal?: AbortSignal): Promise<RemoteStyle | undefined> {
    // `.json` returns GeoServer style metadata. MBStyle content is selected by
    // its native media type on the extensionless endpoint.
    const response = await request(`${stylePath(workspace, name, format)}?quietOnNotFound=true`, 'GET', undefined, undefined, signal,
      format === 'mbstyle' ? { Accept: 'application/vnd.geoserver.mbstyle+json' } : undefined)
    if (response.status === 404) return undefined
    if (!response.ok) throw new Error(`读取远端样式失败（HTTP ${response.status}）`)
    const content = await response.text()
    const hash = format === 'sld' ? await fingerprintSld(content) : await fingerprintMbStyle(content)
    return { content, hash, ...(response.headers.get('ETag') ? { etag: response.headers.get('ETag')! } : {}) }
  }
  const readStyle = (workspace: string, name: string, signal?: AbortSignal) => readRemoteStyle(workspace, name, 'sld', signal)
  const readMbStyle = (workspace: string, name: string, signal?: AbortSignal) => readRemoteStyle(workspace, name, 'mbstyle', signal)
  async function readLayer(workspace: string, name: string, signal?: AbortSignal): Promise<GeoServerLayer> {
    return (await json<{ layer: GeoServerLayer }>(`rest/layers/${segment(`${workspace}:${name}`)}.json`, signal)).layer
  }
  async function verifyPng(path: string, signal?: AbortSignal): Promise<Uint8Array> {
    const response = await request(path, 'GET', undefined, undefined, signal)
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) throw new Error(`WMS 未返回 PNG（HTTP ${response.status}）`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.length < 33 || [137,80,78,71,13,10,26,10].some((value, index) => bytes[index] !== value)) throw new Error('WMS PNG 内容无效')
    return bytes
  }
  async function probeMbStyleSupport(signal?: AbortSignal): Promise<MbStyleCapability> {
    try {
      const [versionResponse, response] = await Promise.all([
        request('rest/about/version.json', 'GET', undefined, undefined, signal),
        request('rest/about/manifest.json?manifest=.*mbstyle.*', 'GET', undefined, undefined, signal)
      ])
      if (!versionResponse.ok) return { supported: false, reason: `GeoServer 版本探测失败（HTTP ${versionResponse.status}）` }
      if (!response.ok) return { supported: false, reason: `GeoServer 模块清单探测失败（HTTP ${response.status}）` }
      const versionPayload = await versionResponse.json() as { about?: { resource?: Array<{ name?: string; '@name'?: string; Version?: string | number }> } }
      const serverVersion = String(versionPayload.about?.resource?.find(item => (item.name ?? item['@name']) === 'GeoServer')?.Version ?? '')
      const payload = await response.json() as { about?: { resource?: Array<{ name?: string; '@name'?: string; 'Implementation-Version'?: string; 'Project-Version'?: string; Version?: string | number }> } }
      const modules = payload.about?.resource ?? []
      // GeoTools also contributes `gt-mbstyle-*`; only the GeoServer extension
      // module's implementation version can be compared to GeoServer's version.
      const module = modules.find(item => /^gs-mbstyle(?:-|$)/i.test(item.name ?? item['@name'] ?? ''))
      const moduleName = module?.name ?? module?.['@name']
      if (!moduleName) return { supported: false, reason: 'GeoServer 模块清单未明确列出 MBStyle 扩展' }
      const moduleVersion = String(module?.['Implementation-Version'] ?? module?.['Project-Version'] ?? module?.Version ?? '')
      if (!serverVersion || !moduleVersion || serverVersion !== moduleVersion) return { supported: false, reason: `MBStyle 扩展与 GeoServer 版本未能确认匹配（服务 ${serverVersion || '未知'}；扩展 ${moduleVersion || '未知'}）`, moduleName, ...(serverVersion ? { serverVersion } : {}) }
      return { supported: true, reason: `GeoServer ${serverVersion} 已加载匹配版本的 MBStyle 扩展`, moduleName, serverVersion }
    } catch (error) {
      if (signal?.aborted) throw error
      return { supported: false, reason: '无法确认 GeoServer 已加载 MBStyle 扩展' }
    }
  }

  async function publishStyle(input: {
    format: 'sld' | 'mbstyle'; workspace: string; layerName: string; styleName: string; content: string; expectedRemoteHash?: string; expectedLayerHash: string;
    packageBytes?: Uint8Array; bbox: [number, number, number, number]; signal?: AbortSignal; onStep?: (step: PublishStep) => void
  }): Promise<{ styleName: string; remoteHash: string; layerHash: string; map: Uint8Array; legend: Uint8Array; steps: PublishStep[] }> {
    const steps: PublishStep[] = []
    const log = (step: string, status: PublishStep['status'], message?: string) => { const entry = { step, status, ...(message ? { message } : {}) }; steps.push(entry); input.onStep?.(entry) }
    let created = false, associated = false, phase = 'preflight'
    const { format, workspace, layerName, styleName, signal } = input
    let publishedStyleName = styleName
    try {
      if (input.bbox.length !== 4 || input.bbox.some(value => !Number.isFinite(value)) || input.bbox[0] >= input.bbox[2] || input.bbox[1] >= input.bbox[3]) throw new Error('WMS 验证范围无效')
      if (format === 'mbstyle' && !(await probeMbStyleSupport(signal)).supported) throw new Error('GeoServer 未确认已加载 MBStyle 扩展')
      const fingerprint = format === 'sld' ? fingerprintSld : fingerprintMbStyle
      const expectedOutputHash = await fingerprint(input.content)
      const read = format === 'sld' ? readStyle : readMbStyle
      const contentType = format === 'sld' ? 'application/vnd.ogc.sld+xml' : 'application/vnd.geoserver.mbstyle+json'
      log(phase, 'started')
      const currentLayer = await readLayer(workspace, layerName, signal)
      if (await hashLayer(currentLayer) !== input.expectedLayerHash) throw new Error('目标图层配置已被远端修改，请重新预检')
      let current = await read(workspace, styleName, signal)
      if (current?.hash !== input.expectedRemoteHash) throw new Error('远端样式已变化或存在同名样式，请检查差异后重新预检')
      // Standard GeoServer does not provide conditional style writes. Keep the
      // existing resource intact and publish an immutable revision instead.
      if (current && !current.etag) {
        const stem = styleName.replace(/-rev-[a-f0-9]{16}$/, '').slice(0, 180)
        publishedStyleName = `${stem}-rev-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
        if (await read(workspace, publishedStyleName, signal)) throw new Error('新版本样式名称发生冲突，请重试预检')
        current = undefined
        log('immutable-revision', 'passed', '服务器未提供条件写入标识；保留原样式并创建新版本')
      }
      log(phase, 'passed')
      phase = 'upload'; log(phase, 'started')
      const payload = input.packageBytes ?? new TextEncoder().encode(input.content)
      const path = current ? stylePath(workspace, publishedStyleName, format) : `rest/workspaces/${segment(workspace)}/styles?name=${segment(publishedStyleName)}`
      const uploaded = await request(path, current ? 'PUT' : 'POST', payload, input.packageBytes ? 'application/zip' : contentType, signal, current?.etag ? { 'If-Match': current.etag } : undefined)
      if (!uploaded.ok) throw new Error(`样式上传失败（HTTP ${uploaded.status}）`)
      created = !current
      log(phase, 'passed')
      phase = 'readback'; log(phase, 'started')
      const remote = await read(workspace, publishedStyleName, signal)
      if (!remote || remote.hash !== expectedOutputHash) throw new Error('远端样式回读与本次输出不一致；保留服务器状态供检查')
      log(phase, 'passed')
      phase = 'associate'; log(phase, 'started')
      if (await hashLayer(await readLayer(workspace, layerName, signal)) !== input.expectedLayerHash) throw new Error('关联前目标图层已被远端修改')
      const associatedResponse = await request(`rest/layers/${segment(`${workspace}:${layerName}`)}`, 'PUT', new TextEncoder().encode(JSON.stringify({ layer: { defaultStyle: { name: publishedStyleName, workspace } } })), 'application/json', signal)
      if (!associatedResponse.ok) throw new Error(`样式关联失败（HTTP ${associatedResponse.status}）`)
      associated = true
      const layer = await readLayer(workspace, layerName, signal)
      if (layer.defaultStyle?.name.split(':').at(-1) !== publishedStyleName || layer.defaultStyle.workspace && layer.defaultStyle.workspace !== workspace) throw new Error('目标图层回读未关联本次样式')
      log(phase, 'passed')
      phase = 'wms'; log(phase, 'started')
      const map = await verifyPng(`wms?${new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: `${workspace}:${layerName}`, STYLES: `${workspace}:${publishedStyleName}`, SRS: 'EPSG:4326', BBOX: input.bbox.join(','), WIDTH: '256', HEIGHT: '256', FORMAT: 'image/png', TRANSPARENT: 'true' })}`, signal)
      const legend = await verifyPng(`wms?${new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetLegendGraphic', LAYER: `${workspace}:${layerName}`, STYLE: `${workspace}:${publishedStyleName}`, FORMAT: 'image/png' })}`, signal)
      log(phase, 'passed')
      return { styleName: publishedStyleName, remoteHash: remote.hash, layerHash: await hashLayer(layer), map, legend, steps }
    } catch (error) {
      log(phase, 'failed', error instanceof Error ? error.message : '发布失败')
      if (created && !associated && phase !== 'associate') {
        try {
          const layer = await readLayer(workspace, layerName)
          if (layer.defaultStyle?.name.split(':').at(-1) !== publishedStyleName) {
            const response = await request(`rest/workspaces/${segment(workspace)}/styles/${segment(publishedStyleName)}?purge=true&recurse=false`, 'DELETE')
            log('cleanup-created-style', response.ok ? 'passed' : 'failed')
          }
        } catch { log('cleanup-created-style', 'failed', '无法确认引用状态，保留新样式') }
      }
      throw new GeoServerPublishError(error instanceof Error ? error.message : '发布失败', steps)
    }
  }
  return {
    baseUrl: base.href.replace(/\/$/, ''), readStyle, readMbStyle, probeMbStyleSupport, readLayer,
    async listWorkspaces(signal?: AbortSignal): Promise<string[]> {
      const value = await json<{ workspaces: { workspace?: Array<{ name: string }> } }>('rest/workspaces.json', signal)
      return value.workspaces.workspace?.map(item => item.name) ?? []
    },
    async listStores(workspace: string, signal?: AbortSignal): Promise<string[]> {
      return (await json<{ dataStores: { dataStore?: Array<{ name: string }> } }>(`rest/workspaces/${segment(workspace)}/datastores.json`, signal)).dataStores.dataStore?.map(item => item.name) ?? []
    },
    async listFeatureTypes(workspace: string, store: string, signal?: AbortSignal): Promise<string[]> {
      return (await json<{ featureTypes: { featureType?: Array<{ name: string }> } }>(`rest/workspaces/${segment(workspace)}/datastores/${segment(store)}/featuretypes.json`, signal)).featureTypes.featureType?.map(item => item.name) ?? []
    },
    async readFeatureType(workspace: string, store: string, name: string, signal?: AbortSignal): Promise<GeoServerFeatureType> {
      return (await json<{ featureType: GeoServerFeatureType }>(`rest/workspaces/${segment(workspace)}/datastores/${segment(store)}/featuretypes/${segment(name)}.json`, signal)).featureType
    },
    async publish(input: { workspace: string; layerName: string; styleName: string; sld: string; expectedRemoteHash?: string; expectedLayerHash: string; packageBytes?: Uint8Array; bbox: [number, number, number, number]; signal?: AbortSignal; onStep?: (step: PublishStep) => void }) {
      return publishStyle({ ...input, format: 'sld', content: input.sld })
    },
    async publishMbStyle(input: { workspace: string; layerName: string; styleName: string; mbstyle: string; expectedRemoteHash?: string; expectedLayerHash: string; bbox: [number, number, number, number]; signal?: AbortSignal; onStep?: (step: PublishStep) => void }) {
      return publishStyle({ ...input, format: 'mbstyle', content: input.mbstyle })
    },
  }
}

export async function hashLayer(layer: GeoServerLayer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(layer)))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
