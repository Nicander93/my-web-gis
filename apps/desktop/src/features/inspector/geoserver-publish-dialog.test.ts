import { describe, expect, it } from 'vitest'
import type { CartographyState } from '@desktop-webgis/gis-core'
import { collectGeoServerFieldReferences, getGeoServerStyleFormatOptions, getRemoteStylePublishCopy, inferGeoServerFieldTypes } from './GeoServerPublishDialog.js'

describe('GeoServer publishing preflight helpers', () => {
  it('collects actual get expressions but ignores literal JSON and geometry-type operands', () => {
    const layers = [
      {
        id: 'roads', type: 'line', source: 'roads-source',
        filter: ['all', ['==', ['get', 'class'], 'primary'], ['==', ['geometry-type'], 'LineString']],
        paint: { 'line-width': ['get', 'width'] },
        layout: { 'line-cap': 'round' }
      },
      {
        id: 'literal-example', type: 'symbol', source: 'roads-source',
        layout: { 'text-field': ['literal', ['get', 'not-a-field']] }
      }
    ] as unknown as CartographyState['styleLayers']

    expect(collectGeoServerFieldReferences(layers).map(reference => reference.field)).toEqual(['class', 'width'])
  })

  it('collects has, !has and legacy comparison fields without walking literal get objects', () => {
    const layers = [{
      id: 'legacy', type: 'line', source: 'roads-source',
      filter: ['all',
        ['has', 'optional_name'],
        ['!has', 'deprecated_name'],
        ['==', 'legacy_code', 7],
        ['==', ['get', 'actual_name'], 'road'],
        ['==', ['get', 'object_key', ['literal', ['get', 'not_a_feature_field']]], 'road']
      ]
    }] as unknown as CartographyState['styleLayers']

    expect(collectGeoServerFieldReferences(layers).map(reference => reference.field)).toEqual([
      'optional_name', 'deprecated_name', 'legacy_code', 'actual_name'
    ])
  })

  it('explains that GeoServer without an ETag keeps the old style and publishes a new revision', () => {
    const copy = getRemoteStylePublishCopy({ hash: 'remote-hash', content: '<StyledLayerDescriptor/>' }, false)
    expect(copy.message).toContain('保留远端现有版本并创建一个新的不可变样式版本')
    expect(copy.confirmation).toContain('旧版本会保留')
    expect(copy.confirmation).not.toContain('覆盖')
  })

  it('offers MBStyle only after the server manifest explicitly confirms the extension', () => {
    expect(getGeoServerStyleFormatOptions({ supported: false, reason: 'manifest unavailable' })).toEqual([
      { value: 'sld', label: 'SLD 1.0（默认）' }
    ])
    expect(getGeoServerStyleFormatOptions({ supported: true, reason: 'loaded', moduleName: 'gs-mbstyle-2.28.2' })).toEqual([
      { value: 'sld', label: 'SLD 1.0（默认）' },
      { value: 'mbstyle', label: 'MBStyle JSON' }
    ])
  })

  it('uses MBStyle wording for remote conflict confirmation', () => {
    const copy = getRemoteStylePublishCopy({ hash: 'remote-hash', content: '{"version":8,"layers":[]}' }, false, 'mbstyle')
    expect(copy.confirmation).toContain('MBStyle')
    expect(copy.message).toContain('不可变样式版本')
  })

  it('maps GeoServer Java bindings to standard filter literal types', () => {
    expect(inferGeoServerFieldTypes({
      name: 'roads',
      attributes: { attribute: [
        { name: 'name', binding: 'java.lang.String' },
        { name: 'count', binding: 'java.lang.Integer' },
        { name: 'length', binding: 'java.math.BigDecimal' },
        { name: 'active', binding: 'java.lang.Boolean' },
        { name: 'shape', binding: 'org.locationtech.jts.geom.MultiLineString' },
        { name: 'unknown', binding: 'custom.Record' }
      ] }
    })).toEqual({ name: 'string', count: 'number', length: 'number', active: 'boolean' })
  })
})
