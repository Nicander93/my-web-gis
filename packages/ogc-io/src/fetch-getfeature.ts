import { OgcError } from './errors.js'
import {
  buildGetFeatureRequestUrl,
  type ResolvedWfsLoadOptions
} from './resolve-wfs.js'
import type { ServiceAuthInput } from './types.js'

export interface FetchGetFeaturePageOptions {
  load: ResolvedWfsLoadOptions
  /** Absolute start index for this page. */
  startIndex: number
  /** Features to request on this page (already clamped to remaining budget). */
  pageSize: number
  auth?: ServiceAuthInput
  timeoutMs?: number
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface GetFeaturePageResult {
  body: string
  contentType: string | null
  status: number
  /** Shareable request URL (auth query token may be present on wire only). */
  requestUrlShareable: string
}

function looksLikeHtml(text: string, contentType: string | null): boolean {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('text/html') || ct.includes('application/xhtml')) return true
  const head = text.slice(0, 256).toLowerCase()
  return head.includes('<!doctype html') || head.includes('<html')
}

/**
 * Fetch one GetFeature page. Auth tokens applied only to the outbound request.
 * Does not parse features; does not write project state.
 */
export async function fetchGetFeaturePage(
  options: FetchGetFeaturePageOptions
): Promise<GetFeaturePageResult> {
  const extraParams: Record<string, string> = {}
  const headers: Record<string, string> = {
    Accept: 'application/json, application/geo+json, application/gml+xml, text/xml, */*'
  }

  if (options.auth?.mode === 'query-token') {
    extraParams[options.auth.param] = options.auth.token
  } else if (options.auth?.mode === 'bearer') {
    headers.Authorization = `Bearer ${options.auth.token}`
  }

  const shareableUrl = buildGetFeatureRequestUrl({
    baseUrl: options.load.getFeatureUrl,
    version: options.load.version,
    typeName: options.load.typeName,
    outputFormat: options.load.outputFormat.value,
    srsName: options.load.srsName,
    pageSize: options.pageSize,
    startIndex: options.startIndex,
    bboxWgs84: options.load.queryExtentWgs84
  })

  const requestUrl = Object.keys(extraParams).length
    ? (() => {
        const u = new URL(shareableUrl)
        for (const [k, v] of Object.entries(extraParams)) u.searchParams.set(k, v)
        return u.toString()
      })()
    : shareableUrl

  const timeoutMs = options.timeoutMs ?? 30_000
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
      if (/ExceptionReport|ServiceException/i.test(text)) {
        throw new OgcError('service-exception', text.slice(0, 240))
      }
      throw new OgcError('protocol', `HTTP ${response.status}`)
    }

    if (looksLikeHtml(text, contentType) && !/FeatureCollection|<wfs:|gml:/i.test(text)) {
      throw new OgcError('html-error', '响应为 HTML')
    }

    if (/ExceptionReport|ServiceExceptionReport/i.test(text.slice(0, 500))) {
      throw new OgcError('service-exception', text.slice(0, 240))
    }

    return {
      body: text,
      contentType,
      status: response.status,
      requestUrlShareable: shareableUrl
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

export interface BoundedLoadPlanPage {
  startIndex: number
  pageSize: number
}

/**
 * Plan GetFeature pages for a bounded load.
 * Pagination only when capabilities allow (`usePaging`); otherwise a single request with maxFeatures.
 */
export function planBoundedGetFeaturePages(options: {
  maxFeatures: number
  usePaging: boolean
  /** Default page size when paging (product default 1000). */
  pageSize?: number
}): BoundedLoadPlanPage[] {
  const max = Math.max(1, options.maxFeatures)
  if (!options.usePaging) {
    return [{ startIndex: 0, pageSize: max }]
  }
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 1000, max))
  const pages: BoundedLoadPlanPage[] = []
  let start = 0
  while (start < max) {
    const size = Math.min(pageSize, max - start)
    pages.push({ startIndex: start, pageSize: size })
    start += size
  }
  return pages
}