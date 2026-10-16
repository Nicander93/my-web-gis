import type { CrsInfo, CsvImportOptions } from '@desktop-webgis/vector-io'
import type { ImportResult } from './import-parser'

export type ImportRequest =
  | { kind: 'geojson'; source: File; options: { sourceCrs?: CrsInfo } }
  | { kind: 'shapefile'; source: File; options?: { selectedLayers?: string[] } }
  | { kind: 'dxf'; source: File; options?: { crs?: CrsInfo; selectedLayers?: string[] } }
  | { kind: 'csv'; source: File; options: CsvImportOptions }

export type ImportTask = ImportRequest
  | { kind: 'dxf-layers'; source: File }
  | { kind: 'csv-preview'; content: string; options?: CsvImportOptions }

/** One worker per parse makes cancellation interrupt synchronous parsers as well. */
export function runImportWorker(request: ImportRequest, signal?: AbortSignal): Promise<ImportResult> {
  return runImportTask<ImportResult>(request, signal)
}

export function runImportTask<T>(request: ImportTask, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
    function cleanup() {
      worker.terminate()
      signal?.removeEventListener('abort', abort)
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
    }
    function abort() {
      cleanup()
      reject(new DOMException('已取消导入', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = event => {
      cleanup()
      if (event.data.failure) reject(new Error(event.data.failure))
      else resolve(event.data.result as T)
    }
    worker.onerror = event => { cleanup(); reject(new Error(event.message || '后台解析失败')) }
    worker.onmessageerror = () => { cleanup(); reject(new Error('无法接收后台解析结果')) }
    try { worker.postMessage(request) } catch (error) { cleanup(); reject(error) }
  })
}
