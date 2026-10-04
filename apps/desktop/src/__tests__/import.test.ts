import { describe, it, expect } from 'vitest'
import { importGeoJson } from '../services/import'

describe('Import GeoJSON', () => {
  it('应该成功导入有效的 GeoJSON', async () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'point-1',
          geometry: { type: 'Point', coordinates: [116.4, 39.9] },
          properties: { name: '北京' }
        }
      ]
    })

    const result = await importGeoJson(new File([geojson], 'test.geojson', { type: 'application/json' }))

    expect(result.errors).toHaveLength(0)
    expect(result.layers).toHaveLength(1)
    expect(result.layers[0].name).toBe('test')
    expect(result.layers[0].features).toHaveLength(1)
    expect(result.layers[0].styleKind).toBe('point')
  })

  it('应该处理无效的 GeoJSON', async () => {
    const invalid = 'not valid json'
    const result = await importGeoJson(new File([invalid], 'invalid.geojson', { type: 'application/json' }))

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.layers).toHaveLength(0)
  })

  it('应该处理取消操作', async () => {
    const result = await importGeoJson(new File([], 'empty.geojson', { type: 'application/json' }))
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('normalizes declared projected GeoJSON and preserves source CRS metadata', async () => {
    const content = JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3857' } }, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [111319.49079327357, 111325.1428663851, 12] }, properties: { name: 'projected' } }] })
    const result = await importGeoJson(new File([content], 'projected.geojson'))
    expect(result.errors).toEqual([])
    expect(result.layers[0].features[0]).toMatchObject({ geometry: { coordinates: [expect.closeTo(1, 8), expect.closeTo(1, 8), 12] }, metadata: { sourceCrs: 'EPSG:3857' } })
    expect(result.layers[0].warnings.join(' ')).toContain('WGS84')
    const conflict = await importGeoJson(new File([content], 'conflict.geojson'), { sourceCrs: { code: 'EPSG:4326' } })
    expect(conflict.layers).toEqual([])
    expect(conflict.errors.join(' ')).toContain('冲突')
  })

  it('requires an explicit CRS for unlabelled projected coordinates and refuses unknown declarations', async () => {
    const input = { type: 'Point', coordinates: [111319.49079327357, 0] }
    const file = new File([JSON.stringify(input)], 'unlabelled.geojson')
    expect((await importGeoJson(file)).errors.join(' ')).toContain('WGS84')
    const explicit = await importGeoJson(file, { sourceCrs: { code: 'EPSG:3857' } })
    expect(explicit.layers[0].features[0].geometry).toMatchObject({ coordinates: [expect.closeTo(1, 8), 0] })
    const unknown = await importGeoJson(new File([JSON.stringify({ ...input, crs: { type: 'name', properties: { name: 'EPSG:999999' } } })], 'unknown.geojson'))
    expect(unknown.layers).toEqual([])
    expect(unknown.errors.length).toBeGreaterThan(0)
  })
})
