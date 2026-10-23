import { isTauri } from '@tauri-apps/api/core'
import { pickSaveFile, writeTextFile } from './files'

/** Save the reviewed native module; resources and credentials remain external references. */
export async function saveCesiumModule(content: string, name: string): Promise<'saved' | 'cancelled' | 'download-started'> {
  const fileName = `${name || 'scene'}.cesium.js`
  if (isTauri()) {
    const path = await pickSaveFile({ title: '导出 CesiumJS 代码', defaultPath: fileName, filters: [{ name: 'JavaScript 模块', extensions: ['js'] }] })
    if (!path) return 'cancelled'
    await writeTextFile(path, content)
    return 'saved'
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'text/javascript;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = fileName; document.body.append(link)
  try { link.click() } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }
  return 'download-started'
}
