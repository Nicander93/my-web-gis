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
      crs: 'EPSG:4326'
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
      yField: 'latitude'
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
      crs: 'EPSG:4326'
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].properties).toEqual({
      '编号': '1',
      '名称': '北京站点'
    })
  })

  it('处理引号包裹的字段', () => {
    const csv = `id,name,longitude,latitude,notes
1,"Point A",116.3975,39.9085,"正常记录"
2,"Point B",121.4737,31.2304,"包含,逗号"`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude'
    })

    expect(result.featureCollection.features).toHaveLength(2)
    expect(result.featureCollection.features[1].properties?.notes).toBe('包含,逗号')
  })

  it('处理字段内换行符', () => {
    const csv = `id,name,longitude,latitude,notes
1,"Point A",116.3975,39.9085,"包含换行
的备注信息"`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude'
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].properties?.notes).toBe('包含换行\n的备注信息')
  })

  it('跳过空行', () => {
    const csv = `id,name,longitude,latitude
1,Point A,116.3975,39.9085

2,Point B,121.4737,31.2304

`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude'
    })

    expect(result.featureCollection.features).toHaveLength(2)
    expect(result.warnings).toHaveLength(0)
  })

  it('跳过无效数字坐标', () => {
    const csv = `id,name,longitude,latitude
1,Valid,116.3975,39.9085
2,Invalid X,invalid,31.2304
3,Invalid Y,116.3975,invalid`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude'
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].code).toBe('CSV_INVALID_ROWS')
    expect(result.warnings[0].count).toBe(2)
  })

  it('跳过超出范围的纬度', () => {
    const csv = `id,name,longitude,latitude
1,Valid,116.3975,39.9085
2,Out of range,113.2644,91.0000`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      crs: 'EPSG:4326'
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toContain('纬度超出范围')
  })

  it('跳过超出范围的经度', () => {
    const csv = `id,name,longitude,latitude
1,Valid,116.3975,39.9085
2,Out of range,181.0000,39.9085`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      crs: 'EPSG:4326'
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0].message).toContain('经度超出范围')
  })

  it('支持 UTF-8 BOM', () => {
    const csv = '\uFEFFid,name,longitude,latitude\n1,Point A,116.3975,39.9085'

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude'
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.featureCollection.features[0].properties).toEqual({
      id: '1',
      name: 'Point A'
    })
  })

  it('支持分号分隔符', () => {
    const csv = `id;name;longitude;latitude
1;Point A;116.3975;39.9085`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      delimiter: ';'
    })

    expect(result.featureCollection.features).toHaveLength(1)
  })

  it('支持 Tab 分隔符', () => {
    const csv = `id\tname\tlongitude\tlatitude
1\tPoint A\t116.3975\t39.9085`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      delimiter: '\t'
    })

    expect(result.featureCollection.features).toHaveLength(1)
  })

  it('接受 CRS 参数用于范围验证', () => {
    const csv = `id,longitude,latitude
1,116.3975,39.9085`

    const result = importCsv(csv, {
      xField: 'longitude',
      yField: 'latitude',
      crs: 'EPSG:4326'
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.warnings).toHaveLength(0)
  })

  it('非 4326 CRS 不验证范围', () => {
    const csv = `id,x,y
1,500000,4000000`

    const result = importCsv(csv, {
      xField: 'x',
      yField: 'y',
      crs: 'EPSG:3857'
    })

    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.warnings).toHaveLength(0)
  })
})

describe('CSV Preview', () => {
  it('返回基础预览信息', () => {
    const csv = `id,name,longitude,latitude
1,Point A,116.3975,39.9085
2,Point B,121.4737,31.2304`

    const preview = previewCsv(csv)

    expect(preview.totalRows).toBe(2)
    expect(preview.fields).toEqual(['id', 'name', 'longitude', 'latitude'])
    expect(preview.sampleRows).toHaveLength(2)
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

  it('检测分隔符', () => {
    const csv = `id;name;longitude;latitude
1;Point A;116.3975;39.9085`

    const preview = previewCsv(csv)

    expect(preview.fields).toEqual(['id', 'name', 'longitude', 'latitude'])
  })
})
