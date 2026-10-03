import { isTauri } from '@tauri-apps/api/core'
import { pickSaveFile, writeTextFile } from './files'

type SceneExportResult =
  | { kind: 'saved'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'download-started' }

/** Save through the desktop adapter; browser previews initiate a download. */
export async function exportCityScene(content: string, projectName: string): Promise<SceneExportResult> {
  const fileName = `${projectName || 'scene'}.scene.json`
  if (isTauri()) {
    const path = await pickSaveFile({
      title: '导出三维场景',
      defaultPath: fileName,
      filters: [{ name: '场景文件', extensions: ['json'] }]
    })
    if (!path) return { kind: 'cancelled' }
    await writeTextFile(path, content)
    return { kind: 'saved', path }
  }

  const objectUrl = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }
  return { kind: 'download-started' }
}
