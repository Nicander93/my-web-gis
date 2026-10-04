import assert from 'node:assert/strict'
import { summarizeByLocation, joinAttributes, joinByLocation } from '@desktop-webgis/spatial-analysis'

const areas = [{ id: 'region', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] }, properties: { code: 'A' } }]
const sites = [{ id: 'site', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { value: 10 } }]
const summary = summarizeByLocation(areas, sites, { predicate: 'intersects', countField: 'sites', summaries: [{ field: 'value', operation: 'mean', output: 'average' }] })
assert.equal(summary[0].properties.sites, 1)
assert.equal(summary[0].properties.average, 10)
const joined = joinAttributes(summary, [{ code: 'A', label: '区域 A' }], { inputKey: 'code', joinKey: 'code', fields: ['label'], prefix: 'lookup_', mode: 'left' })
assert.equal(joined[0].properties.lookup_label, '区域 A')
assert.equal(areas[0].properties.sites, undefined)
assert.equal(joinByLocation(sites, areas, { predicate: 'within', fields: ['code'], prefix: 'region_', mode: 'left' })[0].properties.region_code, 'A')
console.log('Built package consumer: region summary, attribute join and spatial join passed')
