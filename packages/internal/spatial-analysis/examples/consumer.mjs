import assert from 'node:assert/strict'
import { summarizeByLocation, joinAttributes, joinByLocation, checkGeometries, clipLines, addGeometryMeasurements, measureGeometry, calculateField, compileFieldExpression } from '@desktop-webgis/spatial-analysis'

const areas = [{ id: 'region', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] }, properties: { code: 'A' } }]
const sites = [{ id: 'site', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { value: 10 } }]
const summary = summarizeByLocation(areas, sites, { predicate: 'intersects', countField: 'sites', summaries: [{ field: 'value', operation: 'mean', output: 'average' }] })
assert.equal(summary[0].properties.sites, 1)
assert.equal(summary[0].properties.average, 10)
const joined = joinAttributes(summary, [{ code: 'A', label: '区域 A' }], { inputKey: 'code', joinKey: 'code', fields: ['label'], prefix: 'lookup_', mode: 'left' })
assert.equal(joined[0].properties.lookup_label, '区域 A')
assert.equal(areas[0].properties.sites, undefined)
assert.equal(joinByLocation(sites, areas, { predicate: 'within', fields: ['code'], prefix: 'region_', mode: 'left' })[0].properties.region_code, 'A')
assert.equal(checkGeometries(areas).valid, 1)
assert.equal(checkGeometries([{ id: 'bad', geometry: null }]).issues[0].code, 'invalid-structure')
const clipped = clipLines([{ id: 'road', geometry: { type: 'LineString', coordinates: [[-1, 5], [11, 5]] }, properties: { road: 'A' } }], areas)
assert.equal(clipped.length, 1)
assert.equal(clipped[0].geometry.type, 'LineString')
assert.equal(clipped[0].properties.road, 'A')
const measured = addGeometryMeasurements(areas, { measurement: 'area', field: 'area_km2', unit: 'square-kilometers' })
assert.ok(measured[0].properties.area_km2 > 0)
assert.ok(measureGeometry(clipped[0].geometry, { measurement: 'length', unit: 'kilometers' }) > 0)
assert.equal(calculateField(sites, { field: 'double', expression: 'field("value") * 2' })[0].properties.double, 20)
assert.equal(compileFieldExpression('coalesce(field("missing"), 0)').evaluate({}), 0)
console.log('Built package consumer: summaries, joins, diagnostics, clipping, measurements and expressions passed')
