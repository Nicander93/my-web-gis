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
  /** 默认 15000。 */
  timeoutMs?: number
  signal?: AbortSignal
  /** 注入的 fetch 实现（浏览器或 Tauri 桥接），默认使用 globalThis.fetch。 */
  fetchImpl?: typeof fetch
}

export interface CapabilitiesXmlResult {
  xml: string
  finalUrl: string
  contentType: string | null
  status: number
  /** 规范化之后的可分享 URL，token 已剥离。 */
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
 * 只负责拉取 GetCapabilities XML，解析单独进行（`parseCapabilitiesXml`）。
 * 不持久化 token；查询 token 只会加到发出的请求 URL 上。
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

  // 如果 URL 本身带了 token 而认证方式又是 none，可分享的版本里仍然要剥掉；
  // 除非调用方选择了 query-token 模式，否则不要重新挂上已剥离的 token。
  if (options.auth?.mode === 'query-token') {
    // 已经在 extraParams 里了
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
      // 浏览器的 CORS 问题通常表现为 TypeError: Failed to fetch
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