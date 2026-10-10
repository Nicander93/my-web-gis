import { isTauri, invoke } from '@tauri-apps/api/core'
import { createSceneArchive, collectSceneResourceReferences, encodeSceneArchiveZip, normalizeSceneArchivePath } from '@desktop-webgis/scene-core'
import { findSecretLeaks } from '@desktop-webgis/gis-core'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import { pickDirectory, pickSaveFile, readSceneResourceFile, writeBinaryFile } from './files'
import type { SceneDocumentSaveResult } from './scene-document-io'

/** Repackage application-owned assets under separate roots, keeping nested relative dependencies intact. */
function prepareCachedResources(input: SceneDocument): { document: SceneDocument; roots: Map<string, string> } {
  const document = structuredClone(input), roots = new Map<string, string>()
  const declared = collectSceneResourceReferences(input).filter(reference => reference.relative).map(reference => normalizeSceneArchivePath(reference.url.split('?')[0]))
  if (input.theme?.logo && !/^[a-z][a-z\d+.-]*:/i.test(input.theme.logo) && !input.theme.logo.startsWith('//')) declared.push(normalizeSceneArchivePath(input.theme.logo))
  const rewrite = (url: string): string => {
    let parsed: URL
    try { parsed = new URL(url) } catch { return url }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.hostname !== 'asset.localhost' || parsed.search || parsed.hash) return url
    let path: string
    try { path = decodeURIComponent(parsed.pathname).replace(/\\/g, '/') } catch { throw new Error('应用资源地址编码无效') }
    path = path.replace(/^\/(?=[a-z]:\/)/i, '')
    const match = /^(.*\/scene-archives\/[^/]+)\/(.+)$/.exec(path)
    if (!match) throw new Error('应用资源不在场景归档目录中')
    let prefix = [...roots].find(([, directory]) => directory === match[1])?.[0]
    if (!prefix) {
      let index = roots.size + 1
      do { prefix = `_archive${index++}` } while (roots.has(prefix) || declared.some(path => path === prefix || path.startsWith(`${prefix}/`) || prefix!.startsWith(`${path}/`)))
      roots.set(prefix, match[1])
    }
    return `${prefix}/${normalizeSceneArchivePath(match[2])}`
  }
  for (const resource of Object.values(document.resources)) {
    if ('url' in resource && typeof resource.url === 'string') resource.url = rewrite(resource.url)
    if (resource.type === 'wmts' && resource.urls) resource.urls = resource.urls.map(rewrite)
  }
  if (document.environment?.basemap) document.environment.basemap.url = rewrite(document.environment.basemap.url)
  if (document.environment?.terrain) document.environment.terrain.url = rewrite(document.environment.terrain.url)
  if (document.theme?.logo) document.theme.logo = rewrite(document.theme.logo)
  return { document, roots }
}

function pickBrowserResourceDirectory(): Promise<Map<string, File> | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'; input.multiple = true; input.setAttribute('webkitdirectory', '')
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.addEventListener('change', () => {
      const files = new Map<string, File>()
      for (const file of input.files ?? []) {
        const relative = file.webkitRelativePath.split('/').slice(1).join('/')
        const path = normalizeSceneArchivePath(relative)
        if (files.has(path)) { resolve(null); return }
        files.set(path, file)
      }
      resolve(files.size ? files : null)
    }, { once: true })
    input.click()
  })
}

/** Exports full content plus local dependencies; remote URLs remain declared external references. */
export async function saveSceneArchive(input: SceneDocument, name: string, signal?: AbortSignal): Promise<SceneDocumentSaveResult> {
  const native = isTauri()
  const { document, roots } = native ? prepareCachedResources(input) : { document: input, roots: new Map<string, string>() }
  if (findSecretLeaks(document).length) throw new Error('场景含疑似密钥字段，不能导出资源包')
  signal?.throwIfAborted()
  const references = collectSceneResourceReferences(document)
  if (document.theme?.logo) references.push({ path: 'theme.logo', url: document.theme.logo, relative: !/^[a-z][a-z\d+.-]*:/i.test(document.theme.logo) && !document.theme.logo.startsWith('//') })
  const cachedRoot = (path: string): [string, string] | undefined => [...roots].find(([prefix]) => path.startsWith(`${prefix}/`))
  const needsDirectory = references.some(reference => reference.relative && !cachedRoot(reference.url.replace(/^\.\//, '')) && !/\{[^}]+\}/.test(reference.url))
  const directory = needsDirectory && native ? await pickDirectory() : null
  const files = needsDirectory && !native ? await pickBrowserResourceDirectory() : null
  signal?.throwIfAborted()
  if (needsDirectory && !directory && !files) return { kind: 'cancelled' }
  const entries = await createSceneArchive(document, { signal, readFile: async path => {
    const cached = cachedRoot(path)
    if (cached) return new Uint8Array(await invoke<number[]>('read_cached_scene_resource', { directory: cached[1], path: path.slice(cached[0].length + 1) }))
    if (directory) return readSceneResourceFile(directory, path)
    const file = files?.get(path)
    if (!file) throw new Error(`资源目录中缺少文件：${path}`)
    if (file.size > 512 * 1024 * 1024) throw new Error(`资源文件过大：${path}`)
    return new Uint8Array(await file.arrayBuffer())
  } })
  const bytes = await encodeSceneArchiveZip(entries, { signal })
  const fileName = `${name || 'scene'}.scene.zip`
  if (native) {
    const path = await pickSaveFile({ title: '导出场景资源包', defaultPath: fileName, filters: [{ name: '场景资源包', extensions: ['zip'] }] })
    signal?.throwIfAborted()
    if (!path) return { kind: 'cancelled' }
    await writeBinaryFile(path, bytes)
    return { kind: 'saved', path }
  }
  const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/zip' }))
  const link = window.document.createElement('a')
  link.href = url; link.download = fileName; window.document.body.append(link)
  try { link.click() }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000) }
  return { kind: 'download-started', name: fileName }
}
