import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { _resetCredentialsForTests, putSessionCredential } from './credentials.js'
import { createGeoServerTransport } from './geoserver-transport.js'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

afterEach(() => {
  _resetCredentialsForTests()
  vi.mocked(invoke).mockReset()
  vi.unstubAllGlobals()
})

describe('GeoServer transport boundary', () => {
  it('sends a browser mutation once and never falls back to native after fetch failure', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('CORS blocked: Bearer secret-token <private body>'))
    vi.stubGlobal('fetch', fetchMock)
    const transport = createGeoServerTransport()

    const pending = transport('https://example.test/geoserver/rest/styles?name=roads', {
      method: 'POST', headers: { 'Content-Type': 'application/vnd.ogc.sld+xml' }, body: new TextEncoder().encode('<sld/>')
    })
    await expect(pending).rejects.toThrow('GeoServer 网络请求失败')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('loads bearer credentials by reference and makes one binary native request', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    vi.mocked(invoke).mockResolvedValue({ status: 200, headers: { 'content-type': 'image/png' }, body: [137, 80, 78, 71] })
    const credentialRef = putSessionCredential({ kind: 'bearer', value: 'secret-token' })
    const transport = createGeoServerTransport({ credentialRef })
    const response = await transport('https://example.test/geoserver/wms', {
      method: 'POST', headers: { 'Content-Type': 'application/zip', Accept: 'image/png' }, body: new Uint8Array([0, 255, 1])
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71])
    expect(invoke).toHaveBeenCalledTimes(1)
    const [command, payload] = vi.mocked(invoke).mock.calls[0]!
    expect(command).toBe('geoserver_http_request')
    expect(payload).toMatchObject({ args: {
      method: 'POST', body: [0, 255, 1], headers: { authorization: 'Bearer secret-token' }
    } })
    expect(JSON.stringify(payload)).not.toContain(credentialRef)
    expect(JSON.stringify(payload)).toContain('Bearer secret-token')
  })

  it('sends a native cancel command when an in-flight signal aborts', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    let rejectRequest!: (error: Error) => void
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === 'cancel_geoserver_http_request') return Promise.resolve(true)
      return new Promise((_resolve, reject) => { rejectRequest = reject })
    })
    const controller = new AbortController()
    const pending = createGeoServerTransport()('https://example.test/geoserver/rest/styles', {
      method: 'PUT', headers: {}, body: new TextEncoder().encode('<sld/>'), signal: controller.signal
    })
    await Promise.resolve()
    controller.abort()
    rejectRequest(new Error('native request cancelled'))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      'geoserver_http_request', 'cancel_geoserver_http_request'
    ])
  })

  it('rejects URL credentials and raw Authorization headers before sending', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const transport = createGeoServerTransport()
    await expect(transport('https://user:password@example.test/geoserver', { method: 'GET', headers: {} }))
      .rejects.toThrow('不含凭据')
    await expect(transport('https://example.test/geoserver', { method: 'GET', headers: { Authorization: 'Bearer raw' } }))
      .rejects.toThrow('安全凭据引用')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('checks the bound origin before loading or forwarding a saved credential', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    const credentialRef = putSessionCredential({ kind: 'http-authorization', value: 'Basic c2VjcmV0' })
    const transport = createGeoServerTransport({ credentialRef, allowedOrigin: 'https://trusted.example/geoserver' })

    await expect(transport('https://attacker.example/geoserver/rest/workspaces', { method: 'GET', headers: {} }))
      .rejects.toThrow('凭据绑定的服务器地址与请求地址不一致')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('rejects query-token credentials instead of moving them into an Authorization header', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const credentialRef = putSessionCredential({ kind: 'query-token', param: 'token', value: 'secret' })
    await expect(createGeoServerTransport({ credentialRef })('https://example.test/geoserver', { method: 'GET', headers: {} }))
      .rejects.toThrow('安全凭据不可用')
    expect(fetch).not.toHaveBeenCalled()
  })
})
