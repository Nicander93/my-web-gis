/** A worker per operation allows cancellation to stop computation and release its memory. No project state is touched. */
export function runProcessingWorker<T>(request: unknown, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    const worker = new Worker(new URL('../features/processing/processing.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => {
      worker.terminate()
      worker.onmessage = null
      worker.onerror = null
      signal.removeEventListener('abort', cancel)
    }
    const cancel = () => { cleanup(); reject(new DOMException('已取消', 'AbortError')) }
    signal.addEventListener('abort', cancel, { once: true })
    worker.onmessage = event => {
      cleanup()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    worker.onerror = () => { cleanup(); reject(new Error('处理程序未能运行，请重试。')) }
    try { worker.postMessage(request) }
    catch { cleanup(); reject(new Error('输入数据无法传递给处理程序。')) }
  })
}
