/** Typed errors for OGC connect / capabilities. Never embed credential secrets in messages. */
export type OgcErrorCode =
  | 'timeout'
  | 'cancelled'
  | 'auth'
  | 'cors'
  | 'network'
  | 'protocol'
  | 'not-xml'
  | 'html-error'
  | 'parse'
  | 'unsupported'

export class OgcError extends Error {
  readonly code: OgcErrorCode
  readonly details?: string

  constructor(code: OgcErrorCode, message: string, details?: string) {
    super(message)
    this.name = 'OgcError'
    this.code = code
    this.details = details
  }
}

export function isOgcError(error: unknown): error is OgcError {
  return error instanceof OgcError
}

/** User-facing Chinese messages (no secrets). */
export function formatOgcErrorMessage(error: unknown): string {
  if (error instanceof OgcError) {
    switch (error.code) {
      case 'timeout':
        return '连接超时，请检查网络或增大超时时间。'
      case 'cancelled':
        return '已取消连接。'
      case 'auth':
        return '认证失败：请检查 Token / Bearer，或确认服务是否需要登录。'
      case 'cors':
        return '浏览器 CORS 阻止了请求。请在 Desktop（Tauri）中连接，或请服务端允许本源访问。不会使用公共代理，也不会关闭 TLS 校验。'
      case 'network':
        return `网络错误：${error.message}`
      case 'protocol':
        return `协议错误：${error.message}`
      case 'not-xml':
        return '响应不是 Capabilities XML（可能是错误页或非 OGC 端点）。'
      case 'html-error':
        return '服务返回了 HTML 错误页，而非 Capabilities 文档。'
      case 'parse':
        return `无法解析 Capabilities：${error.message}`
      case 'unsupported':
        return error.message
      default:
        return error.message
    }
  }
  if (error instanceof Error) return error.message
  return String(error)
}