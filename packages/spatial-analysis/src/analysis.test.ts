import { describe, expect, it } from 'vitest'
import { joinAttributes, joinByLocation, summarizeByLocation, type AnalysisFeature } from './index'

const point = (id: string, x: number, value: unknown = 10): AnalysisFeature => ({ id, geometry: { type: 'Point', coordinates: [x, 2] }, properties: { value } })
const region = (id: string, west = 0): AnalysisFeature => ({ id, geometry: { type: 'Polygon', coordinates: [[[west, 0], [west + 10, 0], [west + 10, 10], [west, 10], [west, 0]]] }, properties: { name: id } })
const summary = { predicate: 'intersects' as const, countField: 'count', summaries: [
  { field: 'value', operation: 'sum' as const, output: 'sum' },
  { field: 'value', operation: 'mean' as const, output: 'mean' },
  { field: 'value', operation: 'min' as const, output: 'min' },
  { field: 'value', operation: 'max' as const, output: 'max' }
] }

describe('region statistics', () => {
  it('retains empty regions and excludes nonnumeric values from numeric summaries', () => {
    const result = summarizeByLocation([region('a'), region('empty', 30)], [point('one', 1, 10), point('two', 2, 20), point('text', 3, '30'), point('null', 4, null), point('nan', 5, NaN)], summary)
    expect(result[0].properties).toEqual({ name: 'a', count: 5, sum: 30, mean: 15, min: 10, max: 20 })
    expect(result[1].properties).toEqual({ name: 'empty', count: 0, sum: 0, mean: null, min: null, max: null })
  })

  it('distinguishes boundary predicates and counts independently across overlapping regions', () => {
    const rows = [point('boundary', 0), point('inside', 5)]
    expect(summarizeByLocation([region('a'), region('b', 4)], rows, summary).map(row => row.properties.count)).toEqual([2, 1])
    expect(summarizeByLocation([region('a')], rows, { ...summary, predicate: 'within' })[0].properties.count).toBe(1)
  })

  it('handles holes, complete lines and multipart features once per region', () => {
    const area = region('hole')
    if (area.geometry.type !== 'Polygon') throw new Error('fixture')
    area.geometry.coordinates.push([[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]])
    const rows: AnalysisFeature[] = [
      { id: 'crossing-hole', geometry: { type: 'LineString', coordinates: [[1, 5], [9, 5]] }, properties: {} },
      { id: 'multi', geometry: { type: 'MultiPoint', coordinates: [[1, 1], [2, 2]] }, properties: {} },
      { id: 'hole', geometry: { type: 'Point', coordinates: [5, 5] }, properties: {} }
    ]
    expect(summarizeByLocation([area], rows, { countField: 'n', predicate: 'intersects' })[0].properties.n).toBe(2)
    expect(summarizeByLocation([area], rows, { countField: 'n', predicate: 'within' })[0].properties.n).toBe(1)
  })

  it('supports empty datasets without modifying inputs or overwriting fields', () => {
    const area = region('a'), before = structuredClone(area)
    const output = summarizeByLocation([area], [], summary)[0]
    expect(output.id).not.toBe(area.id)
    expect(output.geometry).not.toBe(area.geometry)
    expect(area).toEqual(before)
    expect(output.properties.mean).toBeNull()
    expect(() => summarizeByLocation([area], [], { ...summary, countField: 'name' })).toThrow('已存在')
    expect(() => summarizeByLocation([area], [], { ...summary, countField: 'sum' })).toThrow('不重复')
  })

  it('rejects invalid geometry, absent fields, dateline ranges and numeric overflow', () => {
    expect(() => summarizeByLocation([region('a')], [point('bad', 999)], summary)).toThrow('WGS84')
    expect(() => summarizeByLocation([point('not-region', 1)], [], summary)).toThrow('不是面')
    expect(() => summarizeByLocation([region('a')], [point('a', 1)], { ...summary, summaries: [{ field: 'missing', output: 'total', operation: 'sum' }] })).toThrow('不存在')
    const dateline = region('date', -170)
    if (dateline.geometry.type === 'Polygon') dateline.geometry.coordinates[0][1][0] = 170
    expect(() => summarizeByLocation([dateline], [], summary)).toThrow('日期变更线')
    expect(() => summarizeByLocation([region('a')], [point('a', 1, Number.MAX_VALUE), point('b', 2, Number.MAX_VALUE)], summary)).toThrow('溢出')
    const bow: AnalysisFeature = { id: 'bow', geometry: { type: 'Polygon', coordinates: [[[0, 0], [5, 5], [0, 5], [5, 0], [0, 0]]] }, properties: {} }
    expect(() => summarizeByLocation([bow], [], summary)).toThrow('几何无效')
  })
})

describe('attribute join', () => {
  const rows = [{ key: 1, label: 'number', nested: { x: 1 } }, { key: '1', label: 'string' }]
  const options = { inputKey: 'value', joinKey: 'key', fields: ['label', 'nested'], prefix: 'joined_', mode: 'left' as const }

  it('preserves typed keys, geometry and independent attributes in left and inner joins', () => {
    const features = [point('n', 1, 1), point('s', 2, '1'), point('unmatched', 3, 2)]
    const output = joinAttributes(features, rows, options)
    expect(output.map(row => row.properties.joined_label)).toEqual(['number', 'string', null])
    expect(output[1].properties.joined_nested).toBeNull()
    expect(output[0].properties.joined_nested).not.toBe(rows[0].nested)
    expect(output[0].geometry).toEqual(features[0].geometry)
    expect(output[0].id).not.toBe(features[0].id)
    expect(joinAttributes(features, rows, { ...options, mode: 'inner' })).toHaveLength(2)
    expect(features[0].properties).toEqual({ value: 1 })
  })

  it('does not match null, missing or complex keys and preserves text case and whitespace', () => {
    const features = [point('null', 1, null), point('object', 2, {}), point('case', 3, 'A'), point('space', 4, ' a')]
    const output = joinAttributes(features, [{ key: null, label: 'bad' }, { key: 'a', label: 'lower' }], { ...options, fields: ['label'] })
    expect(output.every(row => row.properties.joined_label === null)).toBe(true)
  })

  it('rejects duplicate keys, collisions and invalid or missing fields', () => {
    expect(() => joinAttributes([point('a', 1, 1)], [...rows, rows[0]], options)).toThrow('重复')
    expect(() => joinAttributes([point('a', 1)], rows, { ...options, fields: ['label', 'label'] })).toThrow('不重复')
    expect(() => joinAttributes([point('a', 1)], rows, { ...options, fields: ['value'], prefix: '' })).toThrow('不存在')
    expect(() => joinAttributes([point('a', 1)], [{ key: 10, value: 1 }], { ...options, fields: ['value'], prefix: '' })).toThrow('已存在')
    expect(() => joinAttributes([point('a', 1)], rows, { ...options, inputKey: 'missing' })).toThrow('不存在')
  })

  it('handles an empty join table for both join modes', () => {
    expect(joinAttributes([point('a', 1)], [], options)[0].properties.joined_label).toBeNull()
    expect(joinAttributes([point('a', 1)], [], { ...options, mode: 'inner' })).toEqual([])
  })
})

describe('spatial join', () => {
  const options = { predicate: 'intersects' as const, fields: ['name'], prefix: 'region_', mode: 'left' as const }
  it('returns each pair once in input order and retains unmatched inputs once', () => {
    const output = joinByLocation([point('inside', 5), point('outside', 50)], [region('a'), region('b', 4)], options)
    expect(output.map(feature => feature.properties.region_name)).toEqual(['a', 'b', null])
    expect(output.map(feature => feature.metadata?.sourceId)).toEqual(['inside', 'inside', 'outside'])
    expect(output.map(feature => feature.metadata?.overlaySourceId)).toEqual(['a', 'b', undefined])
    expect(new Set(output.map(feature => feature.id)).size).toBe(3)
    expect(joinByLocation([point('outside', 50)], [region('a')], { ...options, mode: 'inner' })).toEqual([])
  })
  it('uses complete geometry for within and supports any pair of geometry types', () => {
    const line: AnalysisFeature = { id: 'line', geometry: { type: 'LineString', coordinates: [[-1, 2], [11, 2]] }, properties: {} }
    expect(joinByLocation([line], [region('a')], { ...options, mode: 'inner', predicate: 'within' })).toEqual([])
    expect(joinByLocation([point('boundary', 0)], [region('a')], { ...options, mode: 'inner' })).toHaveLength(1)
    expect(joinByLocation([point('boundary', 0)], [region('a')], { ...options, mode: 'inner', predicate: 'within' })).toEqual([])
    const other = { ...point('other', 1), properties: { name: 'same point' } }
    expect(joinByLocation([point('p', 1)], [other], options)[0].properties.region_name).toBe('same point')
  })
  it('supports an empty join layer and rejects output collisions', () => {
    expect(joinByLocation([point('p', 1)], [], options)[0].properties.region_name).toBeNull()
    expect(() => joinByLocation([region('a')], [region('b')], { ...options, prefix: '' })).toThrow('已存在')
  })
})
