import { invoke, isTauri } from '@tauri-apps/api/core'

export const RECOVERY_ENTRY_BYTES = 32 * 1024 * 1024
export const RECOVERY_TOTAL_BYTES = 128 * 1024 * 1024
export const RECOVERY_MAX_PROJECTS = 20
export const RECOVERY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface RecoveryCacheEntry { key: string; text: string | null; error?: string; stamp?: string }
export interface RecoveryCache {
  list(): Promise<RecoveryCacheEntry[]>
  write(key: string, text: string, expectedText: string | null): Promise<void>
  remove(key: string, expectedText: string | null, expectedStamp?: string): Promise<boolean>
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('desktop-webgis-recovery', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('projects')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开恢复缓存'))
    request.onblocked = () => reject(new Error('恢复缓存升级被其他窗口阻止'))
  })
}

async function browserTransaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await database()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('projects', mode)
    let value: T
    transaction.oncomplete = () => { db.close(); resolve(value) }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('恢复缓存事务失败')) }
    transaction.onerror = () => { /* onabort reports the transaction failure. */ }
    try { run(transaction.objectStore('projects'), (next) => { value = next }) }
    catch (error) { transaction.abort(); db.close(); reject(error) }
  })
}

export const recoveryCache: RecoveryCache = {
  async list() {
    if (isTauri()) return invoke<RecoveryCacheEntry[]>('list_recovery_cache')
    return browserTransaction('readonly', (store, result) => {
      const entries: RecoveryCacheEntry[] = []
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        const item = cursor.result
        if (!item) { result(entries); return }
        entries.push({ key: String(item.key), text: typeof item.value === 'string' ? item.value : null,
          ...(typeof item.value === 'string' ? {} : { error: '缓存内容不是文本' }) })
        item.continue()
      }
    })
  },
  async write(key, text, expectedText) {
    if (isTauri()) return invoke<void>('write_recovery_cache', { key, content: text, expectedContent: expectedText })
    return browserTransaction('readwrite', (store, result) => {
      const entries = store.getAll(), keys = store.getAllKeys()
      let loaded = 0
      const write = () => {
        if (++loaded !== 2) return
        const bytes = new TextEncoder().encode(text).length
        const index = keys.result.indexOf(key)
        if ((index < 0 ? null : entries.result[index]) !== expectedText) { store.transaction.abort(); return }
        const others = entries.result.filter((_, index) => keys.result[index] !== key)
        const total = others.reduce((sum, value) => sum + new TextEncoder().encode(String(value)).length, bytes)
        if (bytes > RECOVERY_ENTRY_BYTES || total > RECOVERY_TOTAL_BYTES || others.length >= RECOVERY_MAX_PROJECTS) {
          store.transaction.abort(); return
        }
        store.put(text, key); result(undefined)
      }
      entries.onsuccess = write; keys.onsuccess = write
    })
  },
  async remove(key, expectedText, expectedStamp) {
    if (isTauri()) return invoke<boolean>('remove_recovery_cache', { key, expectedContent: expectedText, expectedStamp: expectedStamp ?? null })
    return browserTransaction('readwrite', (store, result) => {
      const read = store.get(key)
      read.onsuccess = () => {
        const matches = expectedText === null ? read.result !== undefined && typeof read.result !== 'string' : read.result === expectedText
        if (matches) store.delete(key)
        result(matches)
      }
    })
  }
}
