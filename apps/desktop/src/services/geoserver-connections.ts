export interface GeoServerConnection {
  id: string
  name: string
  baseUrl: string
  credentialRef?: string
}

const STORAGE_KEY = 'desktop-webgis:geoserver-connections:v1'

export function createGeoServerConnectionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `geoserver-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createBasicAuthorization(username: string, password: string): string {
  if (username.includes(':') || /[\r\n]/.test(username) || /[\r\n]/.test(password)) throw new Error('GeoServer 用户名或密码格式无效')
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `Basic ${btoa(binary)}`
}

function getStorage(): Storage | undefined {
  try { return typeof localStorage === 'undefined' ? undefined : localStorage } catch { return undefined }
}

export function validateGeoServerBaseUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('请输入有效的 GeoServer 根地址') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('GeoServer 根地址须为不含账号、查询参数和片段的 HTTP(S) 地址')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.href.replace(/\/$/, '')
}

function parseConnection(value: unknown): GeoServerConnection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !record.id || record.id.length > 128
      || typeof record.name !== 'string' || !record.name.trim() || record.name.length > 128
      || typeof record.baseUrl !== 'string') return undefined
  try {
    return {
      id: record.id,
      name: record.name.trim(),
      baseUrl: validateGeoServerBaseUrl(record.baseUrl),
      ...(typeof record.credentialRef === 'string' && record.credentialRef ? { credentialRef: record.credentialRef } : {})
    }
  } catch { return undefined }
}

export function listGeoServerConnections(storage: Storage | undefined = getStorage()): GeoServerConnection[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const unique = new Set<string>()
    return parsed.flatMap(value => {
      const connection = parseConnection(value)
      if (!connection || unique.has(connection.id)) return []
      unique.add(connection.id)
      return [connection]
    })
  } catch { return [] }
}

/** Stores connection metadata and a credential reference only; never accepts secret fields. */
export function saveGeoServerConnection(input: GeoServerConnection, storage: Storage | undefined = getStorage()): GeoServerConnection[] {
  if (!storage) throw new Error('当前环境无法保存 GeoServer 连接配置')
  if (!input.id || input.id.length > 128 || !input.name.trim() || input.name.length > 128) throw new Error('连接名称或 ID 无效')
  const connection: GeoServerConnection = {
    id: input.id,
    name: input.name.trim(),
    baseUrl: validateGeoServerBaseUrl(input.baseUrl),
    ...(input.credentialRef ? { credentialRef: input.credentialRef } : {})
  }
  const next = [...listGeoServerConnections(storage).filter(existing => existing.id !== connection.id), connection]
  storage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function removeGeoServerConnection(id: string, storage: Storage | undefined = getStorage()): GeoServerConnection[] {
  if (!storage) return []
  const next = listGeoServerConnections(storage).filter(connection => connection.id !== id)
  storage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}
