import { describe, it, expect } from 'vitest'
import { importCsvFile, previewCsvFile } from '@/services/import'

describe('CSV Import Service', () => {
  it('预览 CSV 文件', async () => {
    const csvContent = `id,name,longitude,latitude
1,北京站点,116.3975,39.9085
2,上海站点,121.4737,31.2304`

    const file = new File([csvContent], 'points.csv', { type: 'text/csv' })
    const preview = await previewCsvFile(file)

    expect(preview.totalRows).toBe(2)
    expect(preview.fields).toEqual(['id', 'name', 'longitude', 'latitude'])
    expect(preview.sampleRows).toHaveLength(2)
  })

  it('导入带有中文的 CSV 文件', async () => {
    const csvContent = `编号,名称,经度,纬度
001,北京站点,116.3975,39.9085
002,上海站点,121.4737,31.2304`

    const file = new File([csvContent], 'chinese-points.csv', { type: 'text/csv' })
    const result = await importCsvFile(file, {
      xField: '经度',
      yField: '纬度',
      crs: 'EPSG:4326'
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
      crs: 'EPSG:4326'
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
      crs: 'EPSG:4326'
    })

    expect(result.layers[0].features[0].properties?.id).toBe('001')
    expect(result.layers[0].features[0].properties?.code).toBe('00123')
  })

  it('处理引号和换行符', async () => {
    const csvContent = `id,name,longitude,latitude,notes
1,"Point A",116.3975,39.9085,"包含,逗号"
2,"Point B",121.4737,31.2304,"包含换行
的备注"`

    const file = new File([csvContent], 'quoted-fields.csv', { type: 'text/csv' })
    const result = await importCsvFile(file, {
      xField: 'longitude',
      yField: 'latitude',
      crs: 'EPSG:4326'
    })

    expect(result.layers[0].features).toHaveLength(2)
    expect(result.layers[0].features[0].properties?.notes).toBe('包含,逗号')
    expect(result.layers[0].features[1].properties?.notes).toContain('包含换行')
  })

  it('识别为点图层', async () => {
    const csvContent = `longitude,latitude
116.3975,39.9085`

    const file = new File([csvContent], 'points.csv', { type: 'text/csv' })
    const result = await importCsvFile(file, {
      xField: 'longitude',
      yField: 'latitude',
      crs: 'EPSG:4326'
    })

    expect(result.layers[0].styleKind).toBe('point')
  })

  it('处理 EPSG:3857 坐标', async () => {
    const csvContent = `id,x,y
1,12958017.00,4850555.00`

    const file = new File([csvContent], 'web-mercator.csv', { type: 'text/csv' })
    const result = await importCsvFile(file, {
      xField: 'x',
      yField: 'y',
      crs: 'EPSG:3857'
    })

    expect(result.layers[0].features).toHaveLength(1)
    expect(result.layers[0].warnings).toHaveLength(0)
  })
})
