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
})
