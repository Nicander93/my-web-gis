import { describe, expect, it } from 'vitest'
import { serializeVectorExport } from '@/features/export/serializeVectorExport'
import { importCsvFile } from '@/services/import'
import type { GisFeature } from '@desktop-webgis/gis-core'

describe('coordinate export workflow', () => {
  const features: GisFeature[] = [{ id: 'a', geometry: { type: 'Point', coordinates: [-1, -1, 20] }, properties: { label: '=value' } }]

  it('exports projected CSV and imports the same XY back into WGS84 without mutating the source', async () => {
    const before = structuredClone(features)
    const exported = serializeVectorExport(features, 'coordinate-csv', 'EPSG:3857')
    const restored = await importCsvFile(new File([exported.content], 'points_EPSG-3857.csv'), { xField: 'x', yField: 'y', crs: { code: 'EPSG:3857' } })
    expect(exported.extension).toBe('csv')
    expect(restored.errors).toEqual([])
    expect(restored.layers[0].features[0].geometry).toMatchObject({ coordinates: [expect.closeTo(-1, 8), expect.closeTo(-1, 8)] })
    expect(restored.layers[0].features[0].metadata?.sourceCrs).toBe('EPSG:3857')
    expect(restored.layers[0].features[0].properties.label).toBe("'=value")
    expect(features).toEqual(before)
  })

  it('keeps GeoJSON geographic despite the CSV target and keeps attribute-only CSV unchanged', () => {
    const output = JSON.parse(serializeVectorExport(features, 'geojson', 'EPSG:3857').content)
    expect(output.features[0].geometry.coordinates).toEqual([-1, -1, 20])
    expect(output.features[0].properties.label).toBe('=value')
    expect(output.crs).toBeUndefined()
    expect(serializeVectorExport(features, 'csv', 'EPSG:3857').content.split('\n')[0]).toBe('id,label')
  })

  it('rejects non-point geometry and conflicting fields before the save picker', () => {
    expect(() => serializeVectorExport([{ ...features[0], geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }], 'coordinate-csv', 'EPSG:4326')).toThrow('单点')
    expect(() => serializeVectorExport([{ ...features[0], properties: { crs: 'existing' } }], 'coordinate-csv', 'EPSG:4326')).toThrow('列冲突')
    expect(() => serializeVectorExport([], 'geojson', 'EPSG:4326')).toThrow('没有要素')
  })
})
