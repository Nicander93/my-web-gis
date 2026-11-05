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
 * 优先用浏览器的 fetch；在 Tauri 里遇到 CORS 或网络失败时，改用原生通道
 * （会校验 TLS，不经过公共代理）。
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