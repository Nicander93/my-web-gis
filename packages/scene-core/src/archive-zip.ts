import { unzip, unzipSync, zip, type AsyncTerminable, type Unzipped } from 'fflate'
import { normalizeSceneArchivePath, readSceneArchive, type SceneArchiveEntry, type SceneArchiveOptions } from './archive.js'

export interface SceneArchiveZipOptions extends Pick<SceneArchiveOptions, 'maxFiles' | 'maxBytes' | 'signal'> {
  maxCompressedBytes?: number
}

function zipLimits(options: SceneArchiveZipOptions) {
  const files = options.maxFiles ?? 10000, bytes = options.maxBytes ?? 512 * 1024 * 1024, compressed = options.maxCompressedBytes ?? bytes
  if (![files, bytes, compressed].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Invalid scene ZIP limits')
  return { files, bytes, compressed }
}

function operation<T>(signal: AbortSignal | undefined, start: (done: (error: Error | null, value: T) => void) => AsyncTerminable): Promise<T> {
  return new Promise((resolve, reject) => {
    let terminate: AsyncTerminable = () => {}, settled = false
    const cleanup = (): void => signal?.removeEventListener('abort', abort)
    const abort = (): void => {
      if (settled) return
      settled = true; terminate(); cleanup()
      reject(signal?.reason ?? new DOMException('Scene ZIP cancelled', 'AbortError'))
    }
    const done = (error: Error | null, value: T): void => {
      if (settled) return
      settled = true; cleanup()
      if (error) reject(error)
      else resolve(value)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    try { terminate = start(done) }
    catch (error) { settled = true; terminate(); cleanup(); reject(error) }
  })
}

/** Encodes validated scene entries asynchronously; cancellation terminates compression workers. */
export async function encodeSceneArchiveZip(entries: readonly SceneArchiveEntry[], options: SceneArchiveZipOptions = {}): Promise<Uint8Array> {
  const limit = zipLimits(options)
  options.signal?.throwIfAborted()
  const archive = readSceneArchive(entries, options)
  const bytes = await operation<Uint8Array>(options.signal, done => zip(Object.fromEntries(archive.files), { level: 6 }, done))
  if (bytes.byteLength > limit.compressed) throw new Error('Scene ZIP exceeds compressed byte limit')
  return bytes
}

/** Rejects unsafe names and declared expansion limits before any accepted file is decompressed. */
export async function decodeSceneArchiveZip(bytes: Uint8Array, options: SceneArchiveZipOptions = {}): Promise<ReturnType<typeof readSceneArchive>> {
  const limit = zipLimits(options)
  options.signal?.throwIfAborted()
  if (bytes.byteLength > limit.compressed) throw new Error('Scene ZIP exceeds compressed byte limit')
  const names = new Set<string>()
  let declaredSize = 0
  // Scan the complete directory without extracting, so a late oversized entry
  // cannot start workers for earlier files before the archive is rejected.
  unzipSync(bytes, { filter: file => {
    const path = normalizeSceneArchivePath(file.name)
    if (names.has(path)) throw new Error(`Duplicate scene ZIP entry: ${path}`)
    names.add(path)
    declaredSize += file.originalSize
    if (names.size > limit.files || declaredSize > limit.bytes || !Number.isSafeInteger(declaredSize)) throw new Error('Scene ZIP exceeds expanded file or byte limit')
    return false
  } })
  options.signal?.throwIfAborted()
  const files = await operation<Unzipped>(options.signal, done => unzip(bytes, { filter: file => !file.name.endsWith('/') }, done))
  options.signal?.throwIfAborted()
  return readSceneArchive(Object.entries(files).map(([path, data]) => ({ path, data })), options)
}
