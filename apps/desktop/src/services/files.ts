import { open, save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

export interface FileContent {
  path: string
  content: string | Uint8Array
}

export async function pickFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters
  })

  if (!selected || Array.isArray(selected)) return null
  return selected
}

export async function pickSaveFile(options?: {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}): Promise<string | null> {
  const selected = await save({
    title: options?.title,
    defaultPath: options?.defaultPath,
    filters: options?.filters
  })
  return selected ?? null
}

export async function readTextFile(path: string): Promise<string> {
  return invoke<string>('read_text_path', { path })
}

export async function readBinaryFile(path: string): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('read_binary_path', { path })
  return new Uint8Array(bytes)
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke('write_text_path', { path, content })
}

export async function writeBinaryFile(path: string, content: Uint8Array): Promise<void> {
  await invoke('write_binary_path', { path, content: Array.from(content) })
}

export async function readFile(path: string, binary: boolean): Promise<string | Uint8Array> {
  return binary ? readBinaryFile(path) : readTextFile(path)
}
