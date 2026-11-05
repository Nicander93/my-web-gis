import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseCapabilitiesXml,
  resolveWfsLoadOptions,
  buildGetFeatureRequestUrl,
  bboxParamForWfs,
  planBoundedGetFeaturePages,
  pickWfsOutputFormat,
  clampWfsMaxFeatures,
  WFS_DEFAULT_MAX_FEATURES,
  WFS_PHASE_MAX_FEATURES
} from './index.js'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures')

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8')
}

describe('P18 WFS bounded load (ogc-io)', () => {
  it('parses WFS 2.0.0 formats, paging, CRS, bbox', () => {
    const desc = parseCapabilitiesXml(loadFixture('wfs-2.0.0-capabilities.xml'), {
      shareableUrl: 'https://example.com/geoserver/wfs',
      hint: 'WFS'
    })
    expect(desc.service).toBe('WFS')
    expect(desc.version).toBe('2.0.0')
    expect(desc.wfsPaging?.supported).toBe(true)
    expect(desc.wfsOutputFormats?.some((f) => /json/i.test(f))).toBe(true)
    expect(desc.wfsGetFeatureUrls?.[0]).toContain('example.com')
    const parks = desc.featureTypes?.find((f) => f.name === 'playground:parks')
    expect(parks?.defaultCrs).toBe('EPSG:4326')
    expect(parks?.bboxWgs84).toEqual([116, 39.5, 117, 40.5])
    expect(parks?.outputFormats?.some((f) => /json/i.test(f))).toBe(true)
  })

  it('parses WFS 1.1.0 feature type and result formats', () => {
    const desc = parseCapabilitiesXml(loadFixture('wfs-1.1.0-capabilities.xml'), {
      shareableUrl: 'https://example.com/geoserver/wfs',
      hint: 'WFS'
    })
    expect(desc.version).toBe('1.1.0')
    expect(desc.featureTypes?.[0]?.name).toBe('playground:roads')
    expect(desc.wfsOutputFormats?.map((f) => f.toLowerCase())).toEqual(
      expect.arrayContaining(['geojson', 'gml2', 'gml3'])
    )
    expect(desc.wfsPaging?.supported).toBe(false)
  })

  it('prefers GeoJSON output format', () => {
    const picked = pickWfsOutputFormat([
      'text/xml; subtype=gml/3.2',
      'application/json',
      'csv'
    ])
    expect(picked.kind).toBe('geojson')
    expect(picked.value).toBe('application/json')
  })

  it('clamps max features to phase guardrail', () => {
    expect(clampWfsMaxFeatures(undefined)).toBe(WFS_DEFAULT_MAX_FEATURES)
    expect(clampWfsMaxFeatures(0)).toBe(1)
    expect(clampWfsMaxFeatures(999999)).toBe(WFS_PHASE_MAX_FEATURES)
  })

  it('resolves load options with view extent', () => {
    const desc = parseCapabilitiesXml(loadFixture('wfs-2.0.0-capabilities.xml'), {
      shareableUrl: 'https://example.com/geoserver/wfs',
      hint: 'WFS'
    })
    const resolved = resolveWfsLoadOptions(desc, {
      typeName: 'playground:parks',
      extentMode: 'view',
      viewExtentWgs84: [116.3, 39.8, 116.5, 40.0],
      maxFeatures: 100
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.options.usePaging).toBe(true)
    expect(resolved.options.outputFormat.kind).toBe('geojson')
    expect(resolved.options.maxFeatures).toBe(100)
    expect(resolved.options.queryExtentWgs84).toEqual([116.3, 39.8, 116.5, 40.0])
  })

  it('builds WFS 2.0 GetFeature URL with lon,lat BBOX sample', () => {
    const url = buildGetFeatureRequestUrl({
      baseUrl: 'https://example.com/geoserver/wfs',
      version: '2.0.0',
      typeName: 'playground:parks',
      outputFormat: 'application/json',
      srsName: 'EPSG:4326',
      pageSize: 500,
      startIndex: 0,
      bboxWgs84: [116.3, 39.8, 116.5, 40.0]
    })
    const u = new URL(url)
    expect(u.searchParams.get('TYPENAMES')).toBe('playground:parks')
    expect(u.searchParams.get('COUNT')).toBe('500')
    expect(u.searchParams.get('SRSNAME')).toBe('EPSG:4326')
    // Sample-validated: WFS 2.0 + bare EPSG:4326 → lon,lat + crs suffix
    expect(u.searchParams.get('BBOX')).toBe('116.3,39.8,116.5,40,EPSG:4326')
  })

  it('builds WFS 1.1 BBOX with lat,lon for urn CRS sample', () => {
    const bbox = bboxParamForWfs({
      version: '1.1.0',
      srsName: 'urn:ogc:def:crs:EPSG::4326',
      bboxWgs84: [116.3, 39.8, 116.5, 40.0]
    })
    expect(bbox).toBe('39.8,116.3,40,116.5')

    const url = buildGetFeatureRequestUrl({
      baseUrl: 'https://example.com/geoserver/wfs',
      version: '1.1.0',
      typeName: 'playground:roads',
      outputFormat: 'GeoJSON',
      srsName: 'urn:ogc:def:crs:EPSG::4326',
      pageSize: 50,
      bboxWgs84: [116.3, 39.8, 116.5, 40.0]
    })
    const u = new URL(url)
    expect(u.searchParams.get('TYPENAME')).toBe('playground:roads')
    expect(u.searchParams.get('MAXFEATURES')).toBe('50')
    expect(u.searchParams.get('BBOX')).toBe('39.8,116.3,40,116.5')
  })

  it('plans pagination only when allowed', () => {
    expect(planBoundedGetFeaturePages({ maxFeatures: 2500, usePaging: false })).toEqual([
      { startIndex: 0, pageSize: 2500 }
    ])
    const pages = planBoundedGetFeaturePages({
      maxFeatures: 2500,
      usePaging: true,
      pageSize: 1000
    })
    expect(pages).toEqual([
      { startIndex: 0, pageSize: 1000 },
      { startIndex: 1000, pageSize: 1000 },
      { startIndex: 2000, pageSize: 500 }
    ])
  })
})
