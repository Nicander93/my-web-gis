import { isTauri } from '@tauri-apps/api/core'
import { createSceneArchive, collectSceneResourceReferences, encodeSceneArchiveZip, normalizeSceneArchivePath } from '@desktop-webgis/scene-core'
import { findSecretLeaks } from '@desktop-webgis/gis-core'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import { pickDirectory, pickSaveFile, readSceneResourceFile, writeBinaryFile } from './files'
import type { SceneDocumentSaveResult } from './scene-document-io'

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
export async function saveSceneArchive(document: SceneDocument, name: string, signal?: AbortSignal): Promise<SceneDocumentSaveResult> {
  if (findSecretLeaks(document).length) throw new Error('场景含疑似密钥字段，不能导出资源包')
  signal?.throwIfAborted()
  const references = collectSceneResourceReferences(document)
  if (document.theme?.logo) references.push({ path: 'theme.logo', url: document.theme.logo, relative: !/^[a-z][a-z\d+.-]*:/i.test(document.theme.logo) && !document.theme.logo.startsWith('//') })
  const needsDirectory = references.some(reference => reference.relative && !/\{[^}]+\}/.test(reference.url))
  const native = isTauri(), directory = needsDirectory && native ? await pickDirectory() : null
  const files = needsDirectory && !native ? await pickBrowserResourceDirectory() : null
  signal?.throwIfAborted()
  if (needsDirectory && !directory && !files) return { kind: 'cancelled' }
  const entries = await createSceneArchive(document, { signal, readFile: async path => {
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
