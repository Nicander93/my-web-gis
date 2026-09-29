import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  buildCapabilitiesRequestUrl,
  fetchCapabilitiesXml,
  formatOgcErrorMessage,
  listSelectableLayers,
  normalizeServiceUrl,
  OgcError,
  parseCapabilitiesXml
} from './index.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8')
}

describe('normalizeServiceUrl', () => {
  it('keeps non-token query params and strips tokens', () => {
    const result = normalizeServiceUrl(
      'https://maps.example.com/geoserver/wms?map=/data/map&token=SECRET&layers=preview'
    )
    expect(result.shareableUrl).toContain('map=')
    expect(result.shareableUrl).toContain('layers=preview')
    expect(result.shareableUrl).not.toContain('SECRET')
    expect(result.shareableUrl).not.toMatch(/token=/i)
    expect(result.strippedTokens.token).toBe('SECRET')
  })

  it('rejects non-http schemes', () => {
    expect(() => normalizeServiceUrl('ftp://x')).toThrow(OgcError)
  })
})

describe('buildCapabilitiesRequestUrl', () => {
  it('merges SERVICE/REQUEST while keeping existing params', () => {
    const url = buildCapabilitiesRequestUrl('https://example.com/wms?map=/foo', {
      service: 'WMS',
      version: '1.3.0'
    })
    const u = new URL(url)
    expect(u.searchParams.get('map')).toBe('/foo')
    expect(u.searchParams.get('SERVICE')).toBe('WMS')
    expect(u.searchParams.get('REQUEST')).toBe('GetCapabilities')
    expect(u.searchParams.get('VERSION')).toBe('1.3.0')
  })
})

describe('parseCapabilitiesXml fixtures', () => {
  it('parses WMS 1.3.0 named layers', () => {
    const xml = loadFixture('wms-1.3.0-capabilities.xml')
    const desc = parseCapabilitiesXml(xml, {
      shareableUrl: 'https://example.com/wms',
      hint: 'WMS'
    })
    expect(desc.service).toBe('WMS')
    expect(desc.version).toBe('1.3.0')
    const selectable = listSelectableLayers(desc)
    expect(selectable.map((l) => l.name).sort()).toEqual(['cities', 'rivers'])
    expect(selectable.find((l) => l.name === 'cities')?.bboxWgs84).toEqual([-180, -90, 180, 90])
  })

  it('parses WMS 1.1.1', () => {
    const desc = parseCapabilitiesXml(loadFixture('wms-1.1.1-capabilities.xml'), {
      shareableUrl: 'https://example.com/wms',
      hint: 'WMS'
    })
    expect(desc.version).toBe('1.1.1')
    expect(listSelectableLayers(desc).map((l) => l.name)).toEqual(['dem'])
  })

  it('parses WMTS 1.0.0 layer and tile matrix set', () => {
    const desc = parseCapabilitiesXml(loadFixture('wmts-1.0.0-capabilities.xml'), {
      shareableUrl: 'https://example.com/wmts',
      hint: 'WMTS'
    })
    expect(desc.service).toBe('WMTS')
    expect(desc.layers[0]?.name).toBe('ortho')
    expect(desc.tileMatrixSets?.[0]?.identifier).toBe('GoogleMapsCompatible')
    expect(desc.tileMatrixSets?.[0]?.tileMatrices?.length).toBe(2)
  })

  it('parses WFS 2.0.0 feature types', () => {
    const desc = parseCapabilitiesXml(loadFixture('wfs-2.0.0-capabilities.xml'), {
      shareableUrl: 'https://example.com/wfs',
      hint: 'WFS'
    })
    expect(desc.service).toBe('WFS')
    expect(desc.featureTypes?.map((f) => f.name).sort()).toEqual([
      'playground:parks',
      'playground:trees'
    ])
  })

  it('rejects HTML error pages', () => {
    expect(() =>
      parseCapabilitiesXml('<!doctype html><html><body>error</body></html>', {
        shareableUrl: 'https://example.com'
      })
    ).toThrow(OgcError)
  })
})

describe('fetchCapabilitiesXml', () => {
  it('separates fetch from parse and never echoes token in shareableUrl', async () => {
    const xml = loadFixture('wms-1.3.0-capabilities.xml')
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('token=SECRET')
      expect(url).toContain('REQUEST=GetCapabilities')
      return new Response(xml, {
        status: 200,
        headers: { 'content-type': 'text/xml' }
      })
    }) as unknown as typeof fetch

    const result = await fetchCapabilitiesXml({
      url: 'https://example.com/wms?map=/data',
      service: 'WMS',
      auth: { mode: 'query-token', param: 'token', token: 'SECRET' },
      fetchImpl
    })

    expect(result.shareableUrl).not.toContain('SECRET')
    expect(result.xml).toContain('WMS_Capabilities')
    const desc = parseCapabilitiesXml(result.xml, { shareableUrl: result.shareableUrl, hint: 'WMS' })
    expect(listSelectableLayers(desc).length).toBe(2)
  })

  it('maps 401 to auth error', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 })) as unknown as typeof fetch
    await expect(
      fetchCapabilitiesXml({
        url: 'https://example.com/wms',
        service: 'WMS',
        auth: { mode: 'bearer', token: 'x' },
        fetchImpl
      })
    ).rejects.toMatchObject({ code: 'auth' })
  })

  it('maps abort without caller signal to timeout', async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    }) as unknown as typeof fetch

    await expect(
      fetchCapabilitiesXml({
        url: 'https://example.com/wms',
        service: 'WMS',
        timeoutMs: 20,
        fetchImpl
      })
    ).rejects.toMatchObject({ code: 'timeout' })
  })

  it('formatOgcErrorMessage explains CORS without suggesting proxy', () => {
    const msg = formatOgcErrorMessage(new OgcError('cors', 'Failed to fetch'))
    expect(msg).toMatch(/CORS/)
    expect(msg).toMatch(/不会使用公共代理/)
    expect(msg).toMatch(/TLS/)
  })
})