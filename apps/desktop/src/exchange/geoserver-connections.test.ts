import { describe, expect, it } from 'vitest'
import { createBasicAuthorization, listGeoServerConnections, removeGeoServerConnection, saveGeoServerConnection, validateGeoServerBaseUrl } from './geoserver-connections.js'
import type { GeoServerConnection } from './geoserver-connections.js'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) }
  }
}

describe('GeoServer saved connection metadata', () => {
  it('normalizes root paths and stores only URL, label, ID, and credential reference', () => {
    const storage = memoryStorage()
    const connection = saveGeoServerConnection({
      id: 'connection-1', name: '  Staging  ', baseUrl: 'https://maps.example.test/geoserver///', credentialRef: 'credential-ref'
    }, storage)

    expect(connection).toEqual([{ id: 'connection-1', name: 'Staging', baseUrl: 'https://maps.example.test/geoserver', credentialRef: 'credential-ref' }])
    expect(listGeoServerConnections(storage)).toEqual(connection)
    expect(storage.getItem('desktop-webgis:geoserver-connections:v1')).not.toContain('password')
    expect(storage.getItem('desktop-webgis:geoserver-connections:v1')).not.toContain('secret')
  })

  it('replaces by ID, removes one connection, and ignores malformed stored rows', () => {
    const storage = memoryStorage()
    saveGeoServerConnection({ id: 'one', name: 'Old', baseUrl: 'http://localhost/geoserver' }, storage)
    saveGeoServerConnection({ id: 'two', name: 'Two', baseUrl: 'https://maps.test/geoserver' }, storage)
    saveGeoServerConnection({ id: 'one', name: 'New', baseUrl: 'http://localhost/geoserver' }, storage)
    const raw = JSON.parse(storage.getItem('desktop-webgis:geoserver-connections:v1')!) as unknown[]
    raw.push({ id: 'bad', name: 'bad', baseUrl: 'https://user:pass@host/geoserver' })
    storage.setItem('desktop-webgis:geoserver-connections:v1', JSON.stringify(raw))

    expect(listGeoServerConnections(storage).map(item => item.name)).toEqual(['Two', 'New'])
    expect(removeGeoServerConnection('two', storage).map(item => item.id)).toEqual(['one'])
  })

  it('rejects embedded credentials, query parameters, fragments, and non-HTTP protocols', () => {
    for (const url of [
      'https://user:password@example.test/geoserver',
      'https://example.test/geoserver?token=secret',
      'https://example.test/geoserver#admin',
      'file:///geoserver'
    ]) expect(() => validateGeoServerBaseUrl(url)).toThrow()
  })

  it('builds UTF-8 Basic credentials without storing the secret in connection metadata', () => {
    const storage = memoryStorage()
    const authorization = createBasicAuthorization('用户', '密碼')
    const base64 = btoa(Array.from(new TextEncoder().encode('用户:密碼'), byte => String.fromCharCode(byte)).join(''))
    expect(authorization).toBe(`Basic ${base64}`)
    saveGeoServerConnection({ id: 'one', name: 'One', baseUrl: 'https://maps.test/geoserver', credentialRef: 'ref-only', password: authorization } as unknown as GeoServerConnection, storage)
    expect(storage.getItem('desktop-webgis:geoserver-connections:v1')).not.toContain('Basic ')
    expect(storage.getItem('desktop-webgis:geoserver-connections:v1')).not.toContain('密碼')
  })
})
