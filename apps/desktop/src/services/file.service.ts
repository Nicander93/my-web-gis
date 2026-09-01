import { open, save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

export interface PickedTextFile {
  path: string
  name: string
  content: string
}

export interface PickedBinaryFile {
  path: string
  name: string
  content: Uint8Array
}

export async function pickTextFile(extensions: string[]): Promise<PickedTextFile | null> {
  if (isTauri()) {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Supported files', extensions }]
    })
    if (!path || Array.isArray(path)) return null
    return {
      path,
      name: basename(path),
      content: await readTextPath(path)
    }
  }

  return pickTextFileInBrowser(extensions)
}

export async function saveTextFile(content: string, defaultPath: string, extensions: string[]): Promise<string | null> {
  if (isTauri()) {
    const path = await save({
      defaultPath,
      filters: [{ name: 'Supported files', extensions }]
    })
    if (!path) return null
    await writeTextPath(path, content)
    return path
  }

  downloadTextFile(content, basename(defaultPath))
  return defaultPath
}

export async function pickBinaryFile(extensions: string[]): Promise<PickedBinaryFile | null> {
  if (isTauri()) {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Supported files', extensions }]
    })
    if (!path || Array.isArray(path)) return null
    return {
      path,
      name: basename(path),
      content: new Uint8Array(await invoke<number[]>('read_binary_path', { path }))
    }
  }
  const picked = await pickBrowserFile(extensions)
  if (!picked) return null
  return {
    path: picked.name,
    name: picked.name,
    content: new Uint8Array(await picked.arrayBuffer())
  }
}

export async function saveBinaryFile(
  content: Uint8Array,
  defaultPath: string,
  extensions: string[]
): Promise<string | null> {
  if (isTauri()) {
    const path = await save({
      defaultPath,
      filters: [{ name: 'Supported files', extensions }]
    })
    if (!path) return null
    await invoke('write_binary_path', { path, content: Array.from(content) })
    return path
  }
  downloadBlob(new Blob([content as BlobPart], { type: 'application/octet-stream' }), basename(defaultPath))
  return defaultPath
}

export async function writeTextToPath(path: string, content: string): Promise<void> {
  if (isTauri()) {
    await writeTextPath(path, content)
    return
  }
  downloadTextFile(content, basename(path))
}

export async function readTextFromPath(path: string): Promise<PickedTextFile> {
  if (!isTauri()) {
    throw new Error('Direct path access is only available in the desktop app.')
  }
  return {
    path,
    name: basename(path),
    content: await readTextPath(path)
  }
}

async function readTextPath(path: string): Promise<string> {
  return invoke<string>('read_text_path', { path })
}

async function writeTextPath(path: string, content: string): Promise<void> {
  await invoke('write_text_path', { path, content })
}

function isTauri(): boolean {
  return '__TAURI_INTERNALS__' in window
}

function pickTextFileInBrowser(extensions: string[]): Promise<PickedTextFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = extensions.map((extension) => `.${extension}`).join(',')
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      resolve({
        path: file.name,
        name: file.name,
        content: await file.text()
      })
    }
    input.click()
  })
}

function pickBrowserFile(extensions: string[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = extensions.map((extension) => `.${extension}`).join(',')
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

function downloadTextFile(content: string, fileName: string): void {
  downloadBlob(new Blob([content], { type: 'application/json;charset=utf-8' }), fileName)
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}
