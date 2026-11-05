import { performance } from 'node:perf_hooks'
import { cpus } from 'node:os'
import assert from 'node:assert/strict'
import { summarizeByLocation, joinByLocation, calculateField, addGeometryMeasurements } from '@desktop-webgis/spatial-analysis'

// Deterministic synthetic data; these timings cover built package APIs, not map rendering or worker transfer.
const sizes = (process.argv[2] ?? '100,1000,10000').split(',').map(Number)
if (sizes.some(size => !Number.isInteger(size) || size < 1 || size > 100000)) throw new Error('Sizes must be integers between 1 and 100000.')
const regions = Array.from({ length: 100 }, (_, index) => {
  const x = index % 10, y = Math.floor(index / 10)
  return { id: `region${index}`, properties: { code: `R${index}` }, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] } }
})
const rows = []
function record(tool, inputCount, run, verify) {
  run() // One warmup; report the median of three runs rather than the first invocation.
  const timings = []
  let result
  for (let repeat = 0; repeat < 3; repeat++) {
    const start = performance.now()
    result = run()
    timings.push(performance.now() - start)
  }
  verify(result)
  rows.push({ tool, inputCount, outputCount: result.length, medianMs: Number(timings.sort((a, b) => a - b)[1].toFixed(3)) })
}
record('measure-area', regions.length,
  () => addGeometryMeasurements(regions, { measurement: 'area', field: 'area_m2', unit: 'square-meters' }),
  result => assert.ok(result.every(row => row.properties.area_m2 > 0)))
for (const size of sizes) {
  const points = Array.from({ length: size }, (_, index) => ({ id: `point${index}`, properties: { value: index % 17 }, geometry: { type: 'Point', coordinates: [index % 10 + 0.25, Math.floor(index % 100 / 10) + 0.25] } }))
  record('calculate-field', size,
    () => calculateField(points, { field: 'double', expression: 'field("value") * 2' }),
    result => { assert.equal(result.length, size); assert.equal(result.at(-1).properties.double, ((size - 1) % 17) * 2) })
  record('summarize-location', size,
    () => summarizeByLocation(regions, points, { predicate: 'within', countField: 'count' }),
    result => { assert.equal(result.length, 100); assert.equal(result.reduce((sum, row) => sum + row.properties.count, 0), size) })
  record('spatial-join', size,
    () => joinByLocation(points, regions, { predicate: 'within', fields: ['code'], prefix: 'region_', mode: 'inner' }),
    result => { assert.equal(result.length, size); assert.ok(result.every(row => row.properties.region_code)) })
  assert.equal(points[0].properties.double, undefined)
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, data: 'Synthetic WGS84: 100 adjacent non-overlapping squares and interior points', warmup: 1, samples: 3, rows }, null, 2))
