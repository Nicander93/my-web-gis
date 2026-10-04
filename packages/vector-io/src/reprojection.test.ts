import { describe, expect, it } from 'vitest'
import { createCoordinateTransform, reprojectFeatures } from './coordinate-transform.js'
import { pointsToCoordinateCsv } from './coordinate-csv.js'
import { importCsv, previewCsv } from './csv.js'
import type { GeoJsonGeometry } from '@desktop-webgis/scene-schema'

describe('reprojection and coordinate interchange', () => {
  it('does not allow an unknown projection to pass via an identity shortcut', () => {
    expect(createCoordinateTransform({ code: 'EPSG:999999' }, 'EPSG:999999').success).toBe(false)
    expect(createCoordinateTransform({}, {}).success).toBe(false)
    const conversion = createCoordinateTransform({ code: 'EPSG:4326' }, 'EPSG:4326')
    expect(() => conversion.transform!([181, 0])).toThrow('WGS84')
    expect(() => conversion.transform!([0, NaN])).toThrow('有限')
    expect(() => conversion.transform!([0])).toThrow('两个')
    expect(() => conversion.transform!([0, 0, Infinity])).toThrow('有限')
  })

  it('accepts explicit projection definitions and WKT without a registered code', () => {
    const wkt = 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]'
    const conversion = createCoordinateTransform({ wkt }, { proj4: '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs' })
    expect(conversion.success).toBe(true)
    expect(conversion.transform!([3, 0, 25])).toEqual([500000, 0, 25])
    expect(createCoordinateTransform({ wkt: 'invalid' }).success).toBe(false)
  })

  it('transforms all geometry nesting, preserves Z/M and copies properties while discarding stale bounds', () => {
    const geometry: GeoJsonGeometry = { type: 'GeometryCollection', geometries: [
      { type: 'Point', coordinates: [1, 1, 3, 4] },
      { type: 'MultiPoint', coordinates: [[1, 1]] },
      { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] },
      { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] },
      { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [0, 1], [0, 0]]]] }
    ] }
    const input = [{ id: 'a', geometry, properties: { nested: { value: 1 } }, bbox: [0, 0, 1, 1] }, { id: 'null', geometry: null, properties: { nested: { value: 2 } }, bbox: [] }]
    const result = reprojectFeatures(input, { code: 'EPSG:4326' }, 'EPSG:3857')
    expect(Object.hasOwn(result[0], 'bbox')).toBe(false)
    expect(result[1].geometry).toBe(null)
    expect(result[0].geometry?.type).toBe('GeometryCollection')
    const collection = result[0].geometry!
    if (collection.type !== 'GeometryCollection') throw new Error('Expected collection')
    expect(collection.geometries[0]).toMatchObject({ coordinates: [expect.closeTo(111319.490793, 5), expect.closeTo(111325.142866, 5), 3, 4] })
    expect(collection.geometries.slice(1).every(member => JSON.stringify(member).includes('111319.'))).toBe(true)
    const restored = reprojectFeatures(result, { code: 'EPSG:3857' }, 'EPSG:4326')
    expect(JSON.stringify(restored[0].geometry, (_key, value) => typeof value === 'number' ? Number(value.toFixed(8)) : value)).toBe(JSON.stringify(geometry))
    result[0].properties.nested.value = 99
    expect(input[0].properties.nested.value).toBe(1)
  })

  it('fails atomically with row context and rejects points outside the supported Mercator world', () => {
    const input = [{ geometry: { type: 'Point' as const, coordinates: [0, 0] } }, { geometry: { type: 'Point' as const, coordinates: [0, 90] } }]
    expect(() => reprojectFeatures(input, { code: 'EPSG:4326' }, 'EPSG:3857')).toThrow('第 2')
    expect(input[0].geometry.coordinates).toEqual([0, 0])
    expect(() => createCoordinateTransform({ code: 'EPSG:3857' }).transform!([30000000, 0])).toThrow('世界范围')
  })

  it('coordinate CSV round-trips negative XY and declares its CRS without overriding attributes', () => {
    const input = [{ id: 'p', geometry: { type: 'Point' as const, coordinates: [-1, -1] }, properties: { label: '=SUM(A1)' } }]
    const csv = pointsToCoordinateCsv(input, { code: 'EPSG:4326' }, { code: 'EPSG:3857' })!
    expect(csv.split('\n')[0]).toBe('id,x,y,crs,label')
    expect(csv).toContain('EPSG:3857')
    expect(csv).toContain("'=SUM(A1)")
    expect(previewCsv(csv).declaredCrs).toBe('EPSG:3857')
    expect(() => importCsv(csv, { xField: 'x', yField: 'y', crs: { code: 'EPSG:4326' } })).toThrow('冲突')
    const imported = importCsv(csv, { xField: 'x', yField: 'y', crs: { code: 'EPSG:3857' } })
    const restored = reprojectFeatures(imported.featureCollection.features, imported.crs!, 'EPSG:4326')
    expect(restored[0].geometry).toMatchObject({ coordinates: [expect.closeTo(-1, 8), expect.closeTo(-1, 8)] })
    expect(() => pointsToCoordinateCsv([{ ...input[0], properties: { x: 1 } }], { code: 'EPSG:4326' }, { code: 'EPSG:3857' })).toThrow('列冲突')
    expect(() => pointsToCoordinateCsv([{ ...input[0], geometry: { type: 'MultiPoint', coordinates: [[0, 0]] } }], { code: 'EPSG:4326' }, { code: 'EPSG:3857' })).toThrow('单点')
    expect(pointsToCoordinateCsv([], { code: 'EPSG:4326' }, { code: 'EPSG:3857' })).toBeNull()
  })

  it('checks CRS conflicts beyond the first five preview rows and rejects a mixed-CRS batch', () => {
    const content = `x,y,crs\n${Array(5).fill('1,1,EPSG:3857').join('\n')}\n1,1,EPSG:4326`
    const preview = previewCsv(content, { xField: 'x', yField: 'y', crs: { code: 'EPSG:3857' } })
    expect(preview.declaredCrs).toBeUndefined()
    expect(preview.errors[0]).toMatchObject({ row: 7 })
    expect(() => importCsv(content, { xField: 'x', yField: 'y', crs: { code: 'EPSG:3857' } })).toThrow('第 7 行')
  })

  it('does not truncate unit suffixes or empty cells into valid coordinates', () => {
    const content = 'x,y\n1m,2\n,2\n1,2'
    expect(previewCsv(content, { xField: 'x', yField: 'y' }).invalidRows).toBe(2)
    const result = importCsv(content, { xField: 'x', yField: 'y', crs: { code: 'EPSG:4326' } })
    expect(result.featureCollection.features).toHaveLength(1)
    expect(result.warnings[0].count).toBe(2)
  })
})
