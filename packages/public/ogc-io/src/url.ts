import { OgcError } from './errors.js'

export type OgcServiceType = 'WMS' | 'WMTS' | 'WFS'

export interface NormalizeServiceUrlOptions {
  /** 已知的 token 查询参数名，需要从可分享的 URL 里剥掉。 */
  tokenParamNames?: string[]
}

export interface NormalizedServiceUrl {
  /** 可分享的 URL，token 已去掉，其它查询参数保留。 */
  shareableUrl: string
  /** 规范化之后的绝对 URL 对象。 */
  url: URL
  /** 从 URL 里剥掉的 token 值，按参数名识别。永远不要记录这些值。 */
  strippedTokens: Record<string, string>
}

const DEFAULT_TOKEN_PARAMS = ['token', 'api_key', 'apikey', 'access_token', 'key', 'authkey']

/**
 * 规范化用户输入的服务 URL：
 * - 去掉首尾空白，必须是 http(s)
 * - 保留已有的非 token 查询参数
 * - 单独提取常见的查询 token，避免它们被持久化到 Dataset 上
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
 * 根据规范化后的可分享基地址，构造 GetCapabilities 请求 URL。
 * 保留已有的查询参数，设置或覆盖 SERVICE 和 REQUEST，提供了 VERSION 时一并覆盖。
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