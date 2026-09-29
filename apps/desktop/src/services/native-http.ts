import { invoke } from '@tauri-apps/api/core'

export interface NativeHttpGetResult {
  status: number
  contentType: string | null
  body: string
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Prefer browser fetch; on CORS / network failure in Tauri, use native channel
 * (TLS verified; no public proxy).
 */
export async function fetchTextPreferNative(
  url: string,
  init: {
    headers?: Record<string, string>
    signal?: AbortSignal
    timeoutMs?: number
  } = {}
): Promise<Response> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: init.headers,
      signal: init.signal
    })
    return response
  } catch (err) {
    if (!isTauri()) throw err
    if (init.signal?.aborted) throw err

    const result = await invoke<NativeHttpGetResult>('http_get_text', {
      url,
      headers: init.headers ?? null,
      timeoutMs: init.timeoutMs ?? 15_000
    })

    return new Response(result.body, {
      status: result.status,
      headers: result.contentType ? { 'content-type': result.contentType } : undefined
    })
  }
}