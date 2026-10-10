import { parseSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'
import { collectSceneResourceReferences } from './resources.js'

export interface SceneArchiveEntry { path: string; data: Uint8Array }
export interface SceneArchiveManifest {
  format: 'webgis-scene-archive'
  version: 1
  document: 'scene.json'
  included: string[]
  external: Array<{ from: string; url: string }>
  selfContained: boolean
}
export interface SceneArchiveOptions {
  /** Reads paths relative to the selected scene directory; the host enforces filesystem access. */
  readFile: (path: string, signal?: AbortSignal) => Promise<Uint8Array>
  signal?: AbortSignal
  maxFiles?: number
  maxBytes?: number
}
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true })
const reserved = new Set(['scene.json', 'archive.json'])

/** Normalizes package paths while preventing absolute paths and traversal outside the package. */
export function normalizeSceneArchivePath(path: string, from = ''): string {
  if (!path || /[\\\u0000-\u001f?#]/.test(path) || path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path)) throw new Error(`Invalid scene archive path: ${path}`)
  const parts = from ? from.split('/').slice(0, -1) : []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    let decoded: string
    try { decoded = decodeURIComponent(part) } catch { throw new Error(`Invalid scene archive path: ${path}`) }
    if (decoded !== part && /[./\\\u0000-\u001f]/.test(decoded)) throw new Error(`Encoded path traversal is not allowed: ${path}`)
    if (part === '..') { if (!parts.length) throw new Error(`Scene archive path escapes its root: ${path}`); parts.pop() }
    else parts.push(part)
  }
  if (!parts.length) throw new Error(`Invalid scene archive path: ${path}`)
  return parts.join('/')
}

function externalUrl(url: string): boolean { return /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//') }
function embeddedUrl(url: string): boolean { return /^data:/i.test(url) }
function jsonDependencies(value: unknown): string[] {
  const result: string[] = []
  // URI-bearing extension fields are traversed too; embedded data URIs need no archive entry.
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) { entry.forEach(visit); return }
    if (!entry || typeof entry !== 'object') return
    for (const [key, child] of Object.entries(entry)) {
      if ((key === 'uri' || key === 'url') && typeof child === 'string') result.push(child)
      else visit(child)
    }
  }
  visit(value)
  return result
}

function glbJson(data: Uint8Array): unknown {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== data.length) throw new Error('Invalid GLB header')
  const length = view.getUint32(12, true)
  if (view.getUint32(16, true) !== 0x4e4f534a || length > data.length - 20) throw new Error('Invalid GLB JSON chunk')
  return JSON.parse(decoder.decode(data.subarray(20, 20 + length)).trim()) as unknown
}

function dependencies(path: string, data: Uint8Array): string[] {
  const suffix = path.split('.').at(-1)?.toLowerCase()
  if (suffix === 'json' || suffix === 'gltf') {
    const value = JSON.parse(decoder.decode(data)) as unknown
    if (value && typeof value === 'object' && 'type' in value && (value.type === 'FeatureCollection' || value.type === 'Feature')) return []
    return jsonDependencies(value)
  }
  if (suffix === 'glb') return jsonDependencies(glbJson(data))
  if (suffix === 'b3dm') {
    if (data.length < 28 || decoder.decode(data.subarray(0, 4)) !== 'b3dm') throw new Error('Invalid B3DM header')
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(4, true) !== 1 || view.getUint32(8, true) !== data.length) throw new Error('Invalid B3DM version or length')
    const offset = 28 + [12, 16, 20, 24].reduce((sum, field) => sum + view.getUint32(field, true), 0)
    if (offset > data.length) throw new Error('Invalid B3DM tables')
    return jsonDependencies(glbJson(data.subarray(offset)))
  }
  if (suffix === 'i3dm' || suffix === 'cmpt' || suffix === 'subtree') throw new Error(`Scene archive dependency format is not supported yet: ${path}`)
  return []
}

function limits(options: Pick<SceneArchiveOptions, 'maxFiles' | 'maxBytes'>): { files: number; bytes: number } {
  const files = options.maxFiles ?? 10000, bytes = options.maxBytes ?? 512 * 1024 * 1024
  if (!Number.isSafeInteger(files) || files < 2 || !Number.isSafeInteger(bytes) || bytes < 1) throw new Error('Invalid scene archive limits')
  return { files, bytes }
}

/** Collects a versioned full-scene package without downloading remote URLs or mutating the scene. */
export async function createSceneArchive(input: SceneDocument, options: SceneArchiveOptions): Promise<SceneArchiveEntry[]> {
  const document = parseSceneDocument(input), limit = limits(options)
  const files = new Map<string, Uint8Array>(), external: SceneArchiveManifest['external'] = []
  const queue: Array<{ from: string; url: string }> = collectSceneResourceReferences(document).map(reference => ({ from: 'scene.json', url: reference.url }))
  if (document.theme?.logo) queue.push({ from: 'scene.json', url: document.theme.logo })
  let size = 0
  const add = (path: string, data: Uint8Array): void => {
    if (files.size + 1 > limit.files || size + data.byteLength > limit.bytes) throw new Error('Scene archive exceeds file or byte limit')
    files.set(path, data.slice()); size += data.byteLength
  }
  add('scene.json', encoder.encode(JSON.stringify(document)))
  for (let index = 0; index < queue.length; index++) {
    options.signal?.throwIfAborted()
    const { from, url } = queue[index]
    if (embeddedUrl(url)) continue
    if (externalUrl(url) || /\{[^}]+\}/.test(url)) { external.push({ from, url }); continue }
    const path = normalizeSceneArchivePath(url, from)
    if (reserved.has(path)) throw new Error(`Scene resource collides with reserved archive entry: ${path}`)
    if (files.has(path)) continue
    if (files.size + 2 > limit.files) throw new Error('Scene archive exceeds file limit')
    let data: Uint8Array
    let removeAbort = (): void => {}
    try {
      const pending = options.readFile(path, options.signal)
      data = options.signal ? await Promise.race([pending, new Promise<Uint8Array>((_resolve, reject) => {
        const signal = options.signal!
        const abort = (): void => reject(signal.reason ?? new DOMException('Scene archive cancelled', 'AbortError'))
        signal.addEventListener('abort', abort, { once: true })
        removeAbort = () => signal.removeEventListener('abort', abort)
        if (signal.aborted) abort()
      })]) : await pending
    }
    catch (error) { options.signal?.throwIfAborted(); throw new Error(`Cannot read scene archive resource: ${path}`, { cause: error }) }
    finally { removeAbort() }
    options.signal?.throwIfAborted()
    add(path, data)
    try { queue.push(...dependencies(path, data).map(url => ({ from: path, url }))) }
    catch (error) { throw new Error(`Cannot collect scene archive dependencies: ${path}`, { cause: error }) }
  }
  options.signal?.throwIfAborted()
  const manifest: SceneArchiveManifest = { format: 'webgis-scene-archive', version: 1, document: 'scene.json', included: [...files.keys()], external, selfContained: external.length === 0 }
  add('archive.json', encoder.encode(JSON.stringify(manifest)))
  return [...files].map(([path, data]) => ({ path, data }))
}

/** Validates decoded archive entries before a platform creates files or exposes resource URLs. */
export function readSceneArchive(entries: readonly SceneArchiveEntry[], options: Pick<SceneArchiveOptions, 'maxFiles' | 'maxBytes'> = {}): { document: SceneDocument; manifest: SceneArchiveManifest; files: ReadonlyMap<string, Uint8Array> } {
  const limit = limits(options), files = new Map<string, Uint8Array>()
  let size = 0
  for (const entry of entries) {
    const path = normalizeSceneArchivePath(entry.path)
    if (files.has(path)) throw new Error(`Duplicate scene archive entry: ${path}`)
    if (files.size + 1 > limit.files || size + entry.data.byteLength > limit.bytes) throw new Error('Scene archive exceeds file or byte limit')
    files.set(path, entry.data.slice()); size += entry.data.byteLength
  }
  const manifestData = files.get('archive.json'), sceneData = files.get('scene.json')
  if (!manifestData || !sceneData) throw new Error('Scene archive manifest or document is missing')
  const value = JSON.parse(decoder.decode(manifestData)) as Partial<SceneArchiveManifest>
  if (value.format !== 'webgis-scene-archive' || value.version !== 1 || value.document !== 'scene.json' || !Array.isArray(value.included) || !Array.isArray(value.external) || typeof value.selfContained !== 'boolean') throw new Error('Invalid scene archive manifest')
  const expected = [...files.keys()].filter(path => path !== 'archive.json')
  if (value.included.length !== expected.length || new Set(value.included).size !== expected.length || !value.included.every(path => typeof path === 'string' && expected.includes(path))) throw new Error('Scene archive inventory does not match its entries')
  if (!value.external.every(item => item && typeof item.from === 'string' && files.has(item.from) && typeof item.url === 'string') || value.selfContained !== (value.external.length === 0)) throw new Error('Invalid scene archive external inventory')
  const document = parseSceneDocument(JSON.parse(decoder.decode(sceneData)))
  const references = collectSceneResourceReferences(document).map(reference => ({ from: 'scene.json', url: reference.url }))
  if (document.theme?.logo) references.push({ from: 'scene.json', url: document.theme.logo })
  for (const [path, data] of files) if (!reserved.has(path)) references.push(...dependencies(path, data).map(url => ({ from: path, url })))
  const actualExternal: SceneArchiveManifest['external'] = []
  for (const reference of references) {
    if (embeddedUrl(reference.url)) continue
    if (externalUrl(reference.url) || /\{[^}]+\}/.test(reference.url)) actualExternal.push(reference)
    else if (!files.has(normalizeSceneArchivePath(reference.url, reference.from))) throw new Error(`Missing scene archive dependency: ${reference.from} → ${reference.url}`)
  }
  const keys = (items: SceneArchiveManifest['external']): string[] => [...new Set(items.map(item => JSON.stringify(item)))].sort()
  if (JSON.stringify(keys(actualExternal)) !== JSON.stringify(keys(value.external))) throw new Error('Scene archive external references do not match its content')
  return { document, manifest: value as SceneArchiveManifest, files }
}
