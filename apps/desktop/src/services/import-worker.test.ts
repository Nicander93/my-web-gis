import { afterEach, describe, expect, it, vi } from 'vitest'
import { runImportWorker } from './import-worker'

class TestWorker {
  static current: TestWorker
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { TestWorker.current = this }
}
afterEach(() => vi.unstubAllGlobals())

describe('import worker lifetime', () => {
  const request = () => ({ kind: 'geojson' as const, source: new File(['{}'], 'data.json'), options: {} })
  it('returns parsed results and terminates the worker', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const result = { layers: [], errors: ['invalid data'] }
    const pending = runImportWorker(request())
    TestWorker.current.onmessage?.({ data: { result } })
    await expect(pending).resolves.toEqual(result)
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce()
    expect(TestWorker.current.onmessage).toBeNull()
  })
  it('cancels synchronous parsing and detaches late results', async () => {
    vi.stubGlobal('Worker', TestWorker)
    const controller = new AbortController()
    const pending = runImportWorker(request(), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce()
    expect(TestWorker.current.onmessage).toBeNull()
  })
  it.each(['parse', 'crash', 'clone'])('cleans up after %s failure', async kind => {
    vi.stubGlobal('Worker', TestWorker)
    const pending = runImportWorker(request())
    if (kind === 'parse') TestWorker.current.onmessage?.({ data: { failure: 'parse failed' } })
    else if (kind === 'crash') TestWorker.current.onerror?.({ message: 'crashed' })
    else TestWorker.current.onmessageerror?.()
    await expect(pending).rejects.toBeInstanceOf(Error)
    expect(TestWorker.current.terminate).toHaveBeenCalledOnce()
  })
  it('does not allocate a worker for an already cancelled request', () => {
    const constructor = vi.fn()
    vi.stubGlobal('Worker', constructor)
    const controller = new AbortController(); controller.abort()
    expect(() => runImportWorker(request(), controller.signal)).toThrow()
    expect(constructor).not.toHaveBeenCalled()
  })
})
