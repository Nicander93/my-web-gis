import { parseSceneDocument, type GeoJsonFeatureCollection, type SceneDocument, type SceneResource } from '@desktop-webgis/scene-schema'

export interface SceneResourceReference {
  path: string
  url: string
  relative: boolean
}

function references(document: SceneDocument): SceneResourceReference[] {
  const result: SceneResourceReference[] = []
  const add = (path: string, url: string): void => {
    result.push({ path, url, relative: !/^[a-z][a-z\d+.-]*:/i.test(url) && !url.startsWith('//') })
  }
  for (const [id, resource] of Object.entries(document.resources)) {
    if ('url' in resource && typeof resource.url === 'string') add(`resources.${id}.url`, resource.url)
    if (resource.type === 'wmts') resource.urls?.forEach((url, index) => add(`resources.${id}.urls[${index}]`, url))
  }
  if (document.environment?.basemap) add('environment.basemap.url', document.environment.basemap.url)
  if (document.environment?.terrain) add('environment.terrain.url', document.environment.terrain.url)
  return result
}

/** 只清点已声明的引用；模型和 Tileset 的嵌套依赖需要额外的资源准备。 */
export function collectSceneResourceReferences(input: SceneDocument): SceneResourceReference[] {
  return references(parseSceneDocument(input))
}

/** 以文档 URL 为基准解析可移植引用，同时保留瓦片模板里的花括号。 */
export function resolveSceneResourceReferences(input: SceneDocument, documentUrl: string): SceneDocument {
  const base = new URL(documentUrl)
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Scene resource base must be an HTTP(S) document URL')
  const document = structuredClone(parseSceneDocument(input))
  const resolve = (url: string): string => {
    if (/^[a-z][a-z\d+.-]*:/i.test(url)) return url
    // URL 会把花括号做百分号编码；引擎占位符必须逐字节保留。
    return new URL(url, base).href.replace(/%7B/gi, '{').replace(/%7D/gi, '}')
  }
  for (const resource of Object.values(document.resources)) {
    if ('url' in resource && typeof resource.url === 'string') resource.url = resolve(resource.url)
    if (resource.type === 'wmts' && resource.urls) resource.urls = resource.urls.map(resolve)
  }
  if (document.environment?.basemap) document.environment.basemap.url = resolve(document.environment.basemap.url)
  if (document.environment?.terrain) document.environment.terrain.url = resolve(document.environment.terrain.url)
  return parseSceneDocument(document)
}

export interface PrepareSceneResourcesOptions {
  /** 传输方式、凭据、文件访问和响应大小限制都由宿主控制。 */
  loadGeoJson: (url: string, context: { resourceId: string; signal?: AbortSignal; resource: SceneResource }) => Promise<unknown>
  signal?: AbortSignal
  /** 省略时准备所有基于 URL 的 GeoJSON 资源；宿主也可以只准备自己引擎用到的资源。 */
  resourceIds?: readonly string[]
}

/** 原子地准备完整的 GeoJSON 数据；失败或取消时不会泄漏半份文档。 */
export async function prepareSceneGeoJsonResources(input: SceneDocument, options: PrepareSceneResourcesOptions): Promise<SceneDocument> {
  const document = parseSceneDocument(input)
  const checkCancelled = (): void => {
    if (options.signal?.aborted) throw new DOMException('Scene resource preparation cancelled', 'AbortError')
  }
  checkCancelled()
  const ids = options.resourceIds ?? Object.keys(document.resources)
  for (const id of new Set(ids)) {
    if (!Object.hasOwn(document.resources, id)) throw new Error(`Scene resource does not exist: ${id}`)
    const resource = document.resources[id]
    if (resource.type !== 'geojson' || !resource.url) continue
    checkCancelled()
    const data = await options.loadGeoJson(resource.url, { resourceId: id, signal: options.signal, resource: structuredClone(resource) })
    checkCancelled()
    const { url: _url, ...definition } = resource
    document.resources[id] = { ...definition, data: data as GeoJsonFeatureCollection }
    // 每个结果校验通过之后，才让宿主加载下一个资源。
    parseSceneDocument(document)
  }
  checkCancelled()
  return parseSceneDocument(document)
}
