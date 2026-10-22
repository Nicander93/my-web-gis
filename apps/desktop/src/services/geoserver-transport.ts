import { invoke } from '@tauri-apps/api/core'
import type { GeoServerRequest, GeoServerTransport } from '@desktop-webgis/ogc-io/geoserver-client'
import { credentialAuthorization, ensureCredentialLoaded } from './credentials.js'

interface NativeGeoServerResponse {
  status: number
  headers: Record<string, string>
  body: number[]
}

export interface GeoServerTransportOptions {
  /** Key stored in Dataset.credentialRef; the secret is loaded only for a request. */
  credentialRef?: string
  timeoutMs?: number
  allowedOrigin?: string
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE'])
const MAX_REQUEST_BYTES = 64 * 1024 * 1024
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_HEADER_BYTES = 16 * 1024

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function abortError(): Error {
  return new DOMException('GeoServer 请求已取消', 'AbortError')
}

function responseFromNative(result: NativeGeoServerResponse): Response {
  const body = result.status === 204 || result.status === 205 || result.status === 304
    ? null
    : new Blob([Uint8Array.from(result.body)])
  return new Response(body, { status: result.status, headers: result.headers })
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `geoserver-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function validateUrl(rawUrl: string): URL {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('GeoServer 请求地址无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('GeoServer 仅允许不含凭据的 HTTP(S) 地址')
  }
  return url
}

function buildHeaders(requestHeaders: Record<string, string>, authorization?: string): Headers {
  if (Object.keys(requestHeaders).some(name => name.toLowerCase() === 'authorization')) {
    throw new Error('GeoServer Authorization 必须通过安全凭据引用提供')
  }
  const headers = new Headers()
  try {
    for (const [name, value] of Object.entries(requestHeaders)) {
      headers.set(name, value)
    }
    if (authorization !== undefined) headers.set('Authorization', authorization)
  } catch {
    throw new Error('GeoServer 请求头无效')
  }
  let size = 0
  headers.forEach((value, name) => { size += name.length + value.length })
  if (size > MAX_HEADER_BYTES) throw new Error('GeoServer 请求头超出大小限制')
  return headers
}

async function readBoundedResponse(response: Response): Promise<Response> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error('GeoServer 响应超出大小限制')
  if (!response.body || response.status === 204 || response.status === 205 || response.status === 304) return response
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('GeoServer 响应超出大小限制')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new Response(new Blob([bytes]), { status: response.status, statusText: response.statusText, headers: response.headers })
}

/** Uses one browser request or one native request; failures never trigger a retry. */
export function createGeoServerTransport(options: GeoServerTransportOptions = {}): GeoServerTransport {
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) throw new Error('GeoServer 请求超时设置无效')

  return async (rawUrl: string, request: GeoServerRequest): Promise<Response> => {
    const url = validateUrl(rawUrl)
    if (options.allowedOrigin && url.origin !== new URL(options.allowedOrigin).origin) throw new Error('凭据绑定的服务器地址与请求地址不一致')
    const method = request.method.toUpperCase()
    if (!HTTP_METHODS.has(method)) throw new Error('GeoServer HTTP 方法不受支持')
    if (request.body && request.body.byteLength > MAX_REQUEST_BYTES) throw new Error('GeoServer 请求体超出大小限制')
    request.signal?.throwIfAborted()

    let authorization: string | undefined
    if (options.credentialRef) {
      const credential = await ensureCredentialLoaded(options.credentialRef)
      authorization = credential && credentialAuthorization(credential)
      if (!authorization) throw new Error('GeoServer 安全凭据不可用')
    }
    request.signal?.throwIfAborted()
    const headers = buildHeaders(request.headers, authorization)
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error('GeoServer 请求超时'))
    }, timeoutMs)
    const abort = () => controller.abort(request.signal?.reason)
    request.signal?.addEventListener('abort', abort, { once: true })

    try {
      if (controller.signal.aborted) throw abortError()
      if (isTauriRuntime()) {
        const id = requestId()
        const cancel = () => {
          void invoke<boolean>('cancel_geoserver_http_request', { requestId: id }).catch(() => false)
        }
        controller.signal.addEventListener('abort', cancel, { once: true })
        try {
          const result = await invoke<NativeGeoServerResponse>('geoserver_http_request', {
            args: {
              requestId: id,
              url: url.href,
              method,
              headers: Object.fromEntries(headers.entries()),
              body: request.body ? Array.from(request.body) : null,
              timeoutMs
            }
          })
          return responseFromNative(result)
        } catch {
          if (controller.signal.aborted) {
            if (timedOut) throw new Error('GeoServer 请求超时')
            throw abortError()
          }
          throw new Error('GeoServer 原生网络请求失败')
        } finally {
          controller.signal.removeEventListener('abort', cancel)
        }
      }

      try {
        const response = await fetch(url.href, {
          method,
          headers,
          ...(request.body ? { body: request.body as BodyInit } : {}),
          signal: controller.signal,
          redirect: 'error'
        })
        return await readBoundedResponse(response)
      } catch {
        if (controller.signal.aborted) {
          if (timedOut) throw new Error('GeoServer 请求超时')
          throw abortError()
        }
        throw new Error('GeoServer 网络请求失败')
      }
    } finally {
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', abort)
    }
  }
}
