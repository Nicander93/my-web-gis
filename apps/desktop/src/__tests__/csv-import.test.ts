import { describe, it, expect } from 'vitest'
import { importCsvFile } from '@/services/import'

describe('CSV Import Service', () => {
  it('导入带有中文的 CSV 文件', async () => {
    const csvContent = `编号,名称,经度,纬度
001,北京站点,116.3975,39.9085
002,上海站点,121.4737,31.2304`

    const file = new File([csvContent], 'chinese-points.csv', { type: 'text/csv' })
    const result = await importCsvFile(file, {
      xField: '经度',
      yField: '纬度',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.layers).toHaveLength(1)
    expect(result.layers[0].name).toBe('chinese-points')
    expect(result.layers[0].features).toHaveLength(2)
    expect(result.layers[0].features[0].properties?.['名称']).toBe('北京站点')
  })

  it('导入带有错误坐标的 CSV 文件', async () => {
    const csvContent = `id,name,longitude,latitude
1,Valid,116.3975,39.9085
2,Invalid X,invalid,31.2304
3,Out of range,113.2644,91.0000`

    const file = new File([csvContent], 'with-errors.csv', { type: 'text/csv' })
    const result = await importCsvFile(file, {
      xField: 'longitude',
      yField: 'latitude',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.layers).toHaveLength(1)
    expect(result.layers[0].features).toHaveLength(1)
    expect(result.layers[0].warnings.length).toBeGreaterThan(0)
    expect(result.layers[0].warnings[0]).toContain('跳过 2 行无效记录')
  })

  it('保留前导零', async () => {
    const csvContent = `id,code,longitude,latitude
001,00123,116.3975,39.9085`

    const file = new File([csvContent], 'leading-zeros.csv', { type: 'text/csv' })
    const result = await importCsvFile(file, {
      xField: 'longitude',
      yField: 'latitude',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.layers[0].features[0].properties?.id).toBe('001')
    expect(result.layers[0].features[0].properties?.code).toBe('00123')
  })

  it('识别为点图层', async () => {
    const csvContent = `longitude,latitude
116.3975,39.9085`

    const file = new File([csvContent], 'points.csv', { type: 'text/csv' })
    const result = await importCsvFile(file, {
      xField: 'longitude',
      yField: 'latitude',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.layers[0].styleKind).toBe('point')
  })

  it('处理 EPSG:3857 坐标并转换为 4326', async () => {
    const csvContent = `id,x,y
1,12958017.00,4850555.00`

    const file = new File([csvContent], 'web-mercator.csv', { type: 'text/csv' })
    const result = await importCsvFile(file, {
      xField: 'x',
      yField: 'y',
      crs: { code: 'EPSG:3857' }
    })

    expect(result.layers[0].features).toHaveLength(1)
    expect(result.layers[0].features[0].geometry.coordinates[0]).toBeCloseTo(116.4, 1)
    expect(result.layers[0].features[0].geometry.coordinates[1]).toBeCloseTo(39.9, 1)
  })
})
