import { parseSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'

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

/** Inventory declared references only; nested model/tileset dependencies need resource preparation. */
export function collectSceneResourceReferences(input: SceneDocument): SceneResourceReference[] {
  return references(parseSceneDocument(input))
}

/** Resolve portable references against the document URL, preserving tile-template braces. */
export function resolveSceneResourceReferences(input: SceneDocument, documentUrl: string): SceneDocument {
  const base = new URL(documentUrl)
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Scene resource base must be an HTTP(S) document URL')
  const document = structuredClone(parseSceneDocument(input))
  const resolve = (url: string): string => {
    if (/^[a-z][a-z\d+.-]*:/i.test(url)) return url
    // URL percent-encodes braces; keep engine placeholders byte-for-byte.
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
