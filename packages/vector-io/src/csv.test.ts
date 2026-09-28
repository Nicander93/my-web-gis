import { describe, it, expect } from 'vitest'
import { importCsv, previewCsv } from './csv.js'

describe('CSV Import', () => {
  it('解析基础 CSV 点数据', () => {
    const csv = `id,name,longitude,latitude
1,Point A,116.3975,39.9085
2,Point B,121.4737,31.2304`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.featureCollection.features).toHaveLength(2)
    expect(result.featureCollection.features[0].geometry).toEqual({
      type: 'Point',
      coordinates: [116.3975, 39.9085]
    })
    expect(result.featureCollection.features[0].properties).toEqual({
      id: '1',
      name: 'Point A'
    })
    expect(result.warnings).toHaveLength(0)
  })

  it('保留前导零的属性值', () => {
    const csv = `id,code,longitude,latitude
001,00123,116.3975,39.9085`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].properties?.id).toBe('001')
    expect(result.featureCollection.features[0].properties?.code).toBe('00123')
  })

  it('处理中文字段名和值', () => {
    const csv = `编号,名称,经度,纬度
1,北京站点,116.3975,39.9085`

    const result = importCsv(csv, {
      xField: '经度',
      yField: '纬度',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].properties).toEqual({
      '编号': '1',
      '名称': '北京站点'
    })
  })

  it('跳过无效数字坐标', () => {
    const csv = `id,name,longitude,latitude
1,Valid,116.3975,39.9085
2,Invalid X,invalid,31.2304
3,Invalid Y,116.3975,invalid`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('CSV_INVALID_ROWS')
    expect(result.warnings[0].count).toBe(2)
  })

  it('跳过超出范围的坐标', () => {
    const csv = `id,name,longitude,latitude
1,Valid,116.3975,39.9085
2,Out of range lat,113.2644,91.0000
3,Out of range lon,181.0000,39.9085`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toContain('跳过 2 行无效记录')
  })

  it('支持 UTF-8 BOM', () => {
    const csv = '\uFEFFid,name,longitude,latitude\n1,Point A,116.3975,39.9085'

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      crs: { code: 'EPSG:4326' }
    })

    expect(result.featureCollection.features).toHaveLength(1)
  })

  it('非 4326 CRS 不验证范围', () => {
    const csv = `id,x,y
1,500000,4000000`

    const result = importCsv(csv, {
      xField: 'x',
      yField: 'y',
      crs: { code: 'EPSG:3857' }
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.warnings).toHaveLength(0)
  })
})

describe('CSV Preview', () => {
  it('返回基础预览信息 (未选择字段)', () => {
    const csv = `id,name,longitude,latitude
1,Point A,116.3975,39.9085
2,Point B,121.4737,31.2304`

    const preview = previewCsv(csv)

    expect(preview.totalRows).toBe(2)
    expect(preview.fields).toEqual(['id', 'name', 'longitude', 'latitude'])
    expect(preview.sampleRows).toHaveLength(2)
    expect(preview.validRows).toBe(0)
    expect(preview.invalidRows).toBe(0)
  })

  it('计算有效和无效行数 (选择字段后)', () => {
    const csv = `id,name,longitude,latitude
1,Valid,116.3975,39.9085
2,Invalid X,invalid,31.2304
3,Out of range,113.2644,91.0000`

    const preview = previewCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      crs: { code: 'EPSG:4326' }
    })

    expect(preview.totalRows).toBe(3)
    expect(preview.validRows).toBe(1)
    expect(preview.invalidRows).toBe(2)
    expect(preview.errors).toHaveLength(2)
  })

  it('最多返回 5 行样本', () => {
    const csv = `id,longitude,latitude
1,116.3975,39.9085
2,121.4737,31.2304
3,113.2644,23.1291
4,114.0579,22.5431
5,120.1551,30.2741
6,108.9476,34.2631
7,117.2838,31.8612`

    const preview = previewCsv(csv)

    expect(preview.totalRows).toBe(7)
    expect(preview.sampleRows).toHaveLength(5)
  })
})
