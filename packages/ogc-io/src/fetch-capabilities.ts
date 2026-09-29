import { OgcError } from './errors.js'
import {
  buildCapabilitiesRequestUrl,
  normalizeServiceUrl,
  type OgcServiceType
} from './url.js'
import type { ServiceAuthInput } from './types.js'

export interface FetchCapabilitiesOptions {
  url: string
  service: OgcServiceType
  version?: string
  auth?: ServiceAuthInput
  /** Default 15000. */
  timeoutMs?: number
  signal?: AbortSignal
  /** Injected fetch (browser or Tauri bridge). Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch
}

export interface CapabilitiesXmlResult {
  xml: string
  finalUrl: string
  contentType: string | null
  status: number
  /** Shareable URL after normalize (tokens stripped). */
  shareableUrl: string
}

function looksLikeHtml(text: string, contentType: string | null): boolean {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return true
  const head = text.slice(0, 256).toLowerCase()
  return head.includes('<!doctype html') || head.includes('<html')
}

function looksLikeXml(text: string, contentType: string | null): boolean {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('xml')) return true
  const trimmed = text.trimStart()
  return trimmed.startsWith('<?xml') || trimmed.startsWith('<')
}

/**
 * Fetch GetCapabilities XML only. Parsing is separate (`parseCapabilitiesXml`).
 * Does not persist tokens; query tokens are applied only to the outbound request URL.
 */
export async function fetchCapabilitiesXml(
  options: FetchCapabilitiesOptions
): Promise<CapabilitiesXmlResult> {
  const normalized = normalizeServiceUrl(options.url, {
    tokenParamNames:
      options.auth?.mode === 'query-token' ? [options.auth.param] : undefined
  })

  const extraParams: Record<string, string> = {}
  const headers: Record<string, string> = {
    Accept: 'application/xml, text/xml, */*'
  }

  if (options.auth?.mode === 'query-token') {
    extraParams[options.auth.param] = options.auth.token
  } else if (options.auth?.mode === 'bearer') {
    headers.Authorization = `Bearer ${options.auth.token}`
  }

  // If URL itself contained a token and auth is none, still strip from shareable;
  // do not re-attach stripped tokens unless caller chose query-token mode.
  if (options.auth?.mode === 'query-token') {
    // already in extraParams
  }

  const requestUrl = buildCapabilitiesRequestUrl(normalized.shareableUrl, {
    service: options.service,
    version: options.version,
    extraParams
  })

  const timeoutMs = options.timeoutMs ?? 15_000
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (!fetchImpl) {
    throw new OgcError('network', '当前环境没有可用的 fetch 实现')
  }

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort)

  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    let response: Response
    try {
      response = await fetchImpl(requestUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      })
    } catch (err) {
      if (options.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        if (options.signal?.aborted) throw new OgcError('cancelled', '已取消')
        throw new OgcError('timeout', '请求超时')
      }
      // Browser CORS often surfaces as TypeError: Failed to fetch
      const msg = err instanceof Error ? err.message : String(err)
      if (/failed to fetch|networkerror|cors|load failed/i.test(msg)) {
        throw new OgcError('cors', msg)
      }
      throw new OgcError('network', msg)
    }

    const contentType = response.headers.get('content-type')
    const text = await response.text()

    if (response.status === 401 || response.status === 403) {
      throw new OgcError('auth', `HTTP ${response.status}`)
    }

    if (!response.ok) {
      if (looksLikeHtml(text, contentType)) {
        throw new OgcError('html-error', `HTTP ${response.status}`)
      }
      throw new OgcError('protocol', `HTTP ${response.status}`)
    }

    if (looksLikeHtml(text, contentType) && !looksLikeXml(text, contentType)) {
      throw new OgcError('html-error', '响应为 HTML')
    }

    if (!looksLikeXml(text, contentType)) {
      throw new OgcError('not-xml', `Content-Type: ${contentType ?? 'unknown'}`)
    }

    return {
      xml: text,
      finalUrl: requestUrl.split('?')[0] ?? requestUrl,
      contentType,
      status: response.status,
      shareableUrl: normalized.shareableUrl
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}