import { OgcError } from './errors.js'

export type OgcServiceType = 'WMS' | 'WMTS' | 'WFS'

export interface NormalizeServiceUrlOptions {
  /** Known token query parameter names to strip from the shareable URL. */
  tokenParamNames?: string[]
}

export interface NormalizedServiceUrl {
  /** Shareable URL (tokens removed; other query params kept). */
  shareableUrl: string
  /** Absolute URL object after normalize. */
  url: URL
  /** Token values stripped from the URL (by param name). Never log these. */
  strippedTokens: Record<string, string>
}

const DEFAULT_TOKEN_PARAMS = ['token', 'api_key', 'apikey', 'access_token', 'key', 'authkey']

/**
 * Normalize a user-entered service URL:
 * - trim, require http(s)
 * - keep existing non-token query params
 * - separately extract common query tokens so they are not persisted on Dataset
 */
export function normalizeServiceUrl(
  input: string,
  options: NormalizeServiceUrlOptions = {}
): NormalizedServiceUrl {
  const trimmed = input.trim()
  if (!trimmed) throw new OgcError('protocol', '服务 URL 不能为空')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new OgcError('protocol', '服务 URL 无效')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OgcError('protocol', '仅支持 http/https 服务地址')
  }

  const tokenNames = new Set(
    (options.tokenParamNames ?? DEFAULT_TOKEN_PARAMS).map((n) => n.toLowerCase())
  )
  const strippedTokens: Record<string, string> = {}
  const kept = new URLSearchParams()

  url.searchParams.forEach((value, key) => {
    if (tokenNames.has(key.toLowerCase())) {
      strippedTokens[key] = value
    } else {
      kept.append(key, value)
    }
  })

  const shareable = new URL(url.origin + url.pathname)
  // Preserve hash-less path; re-apply kept params (order may differ — values preserved).
  for (const [key, value] of kept.entries()) {
    shareable.searchParams.append(key, value)
  }

  return {
    shareableUrl: shareable.toString(),
    url: shareable,
    strippedTokens
  }
}

export interface BuildCapabilitiesRequestOptions {
  service: OgcServiceType
  version?: string
  /** Extra query params to merge (e.g. auth query token — caller supplies at request time only). */
  extraParams?: Record<string, string>
}

/**
 * Build a GetCapabilities request URL from a normalized shareable base.
 * Keeps existing query params; sets/overrides SERVICE + REQUEST (+ VERSION when provided).
 */
export function buildCapabilitiesRequestUrl(
  shareableUrl: string,
  options: BuildCapabilitiesRequestOptions
): string {
  const url = new URL(shareableUrl)
  url.searchParams.set('SERVICE', options.service)
  url.searchParams.set('REQUEST', 'GetCapabilities')
  if (options.version) {
    url.searchParams.set('VERSION', options.version)
  }
  if (options.extraParams) {
    for (const [key, value] of Object.entries(options.extraParams)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}