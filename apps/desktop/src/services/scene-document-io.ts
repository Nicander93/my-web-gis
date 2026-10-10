import { isTauri, invoke, convertFileSrc } from '@tauri-apps/api/core'
import { findSecretLeaks } from '@desktop-webgis/gis-core'
import { parseSceneDocument, migrateSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'
import { decodeSceneArchiveZip, normalizeSceneArchivePath, prepareSceneGeoJsonResources, resolveSceneResourceReferences, serializeSceneDocument } from '@desktop-webgis/scene-core'
import { createProjectFromSceneDocument } from '@/features/scene/project-scene-document'
import { pickFile, pickSaveFile, readBinaryFile, readTextFile, writeTextFile } from './files'
import { downloadProject, pickBrowserProject } from './browser-project-files'
import { fetchTextPreferNative } from './native-http'

const filter = { name: '场景 JSON', extensions: ['json'] }
const archiveFilter = { name: '场景资源包', extensions: ['zip'] }
function assertNoSceneSecrets(document: SceneDocument): void {
  const leaks = findSecretLeaks(document)
  if (leaks.length) throw new Error(`场景含疑似密钥字段：${leaks.slice(0, 5).join(', ')}`)
}
export interface OpenedSceneDocument { path: string; document: SceneDocument }
export type SceneDocumentSaveResult = { kind: 'saved'; path: string } | { kind: 'download-started'; name: string } | { kind: 'cancelled' }

/** Scene IO never changes the current .webgis.json save destination. */
export async function openSceneDocument(signal?: AbortSignal): Promise<OpenedSceneDocument | null> {
  let path: string, text: string
  if (isTauri()) {
    const selected = await pickFile([filter, archiveFilter])
    if (!selected) return null
    path = selected
    if (/\.zip$/i.test(path)) return openSceneArchiveBytes(await readBinaryFile(path), path, signal)
    text = await readTextFile(path)
  } else {
    const file = await pickBrowserProject('.json,.zip')
    if (!file) return null
    path = file.name
    if (/\.zip$/i.test(path)) return openSceneArchiveBytes(new Uint8Array(await file.arrayBuffer()), path, signal)
    text = await file.text()
  }
  signal?.throwIfAborted()
  const input: unknown = JSON.parse(text)
  let document = input && typeof input === 'object' && 'version' in input && input.version === 3 ? parseSceneDocument(input) : migrateSceneDocument(input)
  assertNoSceneSecrets(document)
  const resourceIds = document.nodes.filter(node => node.type === 'vector').map(node => node.resource)
  document = await prepareSceneGeoJsonResources(document, { resourceIds, signal, loadGeoJson: async (url, context) => {
    if (context.resource.authentication) throw new Error('认证矢量资源需先配置凭据加载适配器')
    if (!/^https?:\/\//i.test(url)) {
      if (!isTauri()) throw new Error('浏览器导入相对资源需要同时选择资源目录，请先使用内嵌数据或绝对 URL')
      const directory = path.replace(/\\/g, '/').replace(/\/[^/]*$/, '/')
      return JSON.parse(await readTextFile(directory + url.replace(/^\.\//, ''))) as unknown
    }
    const response = await fetchTextPreferNative(url, { signal: context.signal })
    if (!response.ok) throw new Error(`矢量资源请求失败：HTTP ${response.status}`)
    return JSON.parse(await response.text()) as unknown
  } })
  return { path, document }
}

/** Validates all package content before persisting assets or returning a replacement document. */
export async function openSceneArchiveBytes(bytes: Uint8Array, path: string, signal?: AbortSignal): Promise<OpenedSceneDocument> {
  const archive = await decodeSceneArchiveZip(bytes, { signal })
  assertNoSceneSecrets(archive.document)
  const resourceIds = archive.document.nodes.filter(node => node.type === 'vector').map(node => node.resource)
  let document = await prepareSceneGeoJsonResources(archive.document, { resourceIds, signal, loadGeoJson: async (url, context) => {
    if (context.resource.authentication) throw new Error('认证矢量资源需先配置凭据加载适配器')
    if (/^https?:\/\//i.test(url)) {
      const response = await fetchTextPreferNative(url, { signal })
      if (!response.ok) throw new Error(`矢量资源请求失败：HTTP ${response.status}`)
      return JSON.parse(await response.text()) as unknown
    }
    const data = archive.files.get(normalizeSceneArchivePath(url))
    if (!data) throw new Error(`资源包中缺少矢量文件：${url}`)
    return JSON.parse(new TextDecoder().decode(data)) as unknown
  } })
  createProjectFromSceneDocument(document)
  signal?.throwIfAborted()
  const localResources = Object.values(document.resources).some(resource => 'url' in resource && typeof resource.url === 'string' && !/^[a-z][a-z\d+.-]*:/i.test(resource.url) && !resource.url.startsWith('//'))
  const localEnvironment = [document.environment?.basemap?.url, document.environment?.terrain?.url, document.theme?.logo].some(url => url && !/^[a-z][a-z\d+.-]*:/i.test(url) && !url.startsWith('//'))
  if (localResources || localEnvironment) {
    if (!isTauri()) throw new Error('包含本地模型的资源包请在桌面端导入；浏览器持久化资源访问尚未接入')
    const directory = await invoke<string>('persist_scene_archive', { files: [...archive.files].map(([path, data]) => ({ path, content: Array.from(data) })) })
    signal?.throwIfAborted()
    const base = convertFileSrc(`${directory.replace(/\\/g, '/')}/scene.json`)
    document = resolveSceneResourceReferences(document, base)
    if (document.theme?.logo) document.theme.logo = new URL(document.theme.logo, base).href
  }
  return { path, document }
}

export async function saveSceneDocument(document: SceneDocument, name: string): Promise<SceneDocumentSaveResult> {
  assertNoSceneSecrets(document)
  const content = serializeSceneDocument(document), fileName = `${name || 'scene'}.scene.json`
  if (!isTauri()) { downloadProject(content, fileName); return { kind: 'download-started', name: fileName } }
  const path = await pickSaveFile({ title: '导出完整场景', defaultPath: fileName, filters: [filter] })
  if (!path) return { kind: 'cancelled' }
  await writeTextFile(path, content)
  return { kind: 'saved', path }
}
