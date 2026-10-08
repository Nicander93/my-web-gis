import { isTauri } from '@tauri-apps/api/core'
import { findSecretLeaks } from '@desktop-webgis/gis-core'
import { parseSceneDocument, migrateSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'
import { serializeSceneDocument } from '@desktop-webgis/scene-core'
import { pickFile, pickSaveFile, readTextFile, writeTextFile } from './files'
import { downloadProject, pickBrowserProject } from './browser-project-files'

const filter = { name: '场景 JSON', extensions: ['json'] }
function assertNoSceneSecrets(document: SceneDocument): void {
  const leaks = findSecretLeaks(document)
  if (leaks.length) throw new Error(`场景含疑似密钥字段：${leaks.slice(0, 5).join(', ')}`)
}
export interface OpenedSceneDocument { path: string; document: SceneDocument }
export type SceneDocumentSaveResult = { kind: 'saved'; path: string } | { kind: 'download-started'; name: string } | { kind: 'cancelled' }

/** Scene IO never changes the current .webgis.json save destination. */
export async function openSceneDocument(): Promise<OpenedSceneDocument | null> {
  let path: string, text: string
  if (isTauri()) {
    const selected = await pickFile([filter])
    if (!selected) return null
    path = selected; text = await readTextFile(path)
  } else {
    const file = await pickBrowserProject()
    if (!file) return null
    path = file.name; text = await file.text()
  }
  const input: unknown = JSON.parse(text)
  const document = input && typeof input === 'object' && 'version' in input && input.version === 3 ? parseSceneDocument(input) : migrateSceneDocument(input)
  assertNoSceneSecrets(document)
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
