import type { PolygonGeometryRequest, PolygonGeometryResult } from './polygon-edit'

/** Each transaction owns a worker; abort terminates computation and releases its listeners. */
export function calculatePolygonEdit(input: PolygonGeometryRequest, signal: AbortSignal, progress: (done: number, total: number) => void): Promise<PolygonGeometryResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    const worker = new Worker(new URL('./polygon-topology.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => {
      worker.onmessage = null; worker.onerror = null
      worker.terminate(); signal.removeEventListener('abort', abort)
    }
    const abort = () => { cleanup(); reject(new DOMException('已取消', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event) => {
      if (signal.aborted) return
      const message = event.data
      if (message.type === 'progress') progress(message.done, message.total)
      else if (message.type === 'result') { cleanup(); resolve(message.result) }
      else if (message.type === 'error') { cleanup(); reject(new Error(message.message)) }
    }
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || '几何计算线程失败')) }
    try { worker.postMessage(input) } catch (error) { cleanup(); reject(error) }
  })
}
