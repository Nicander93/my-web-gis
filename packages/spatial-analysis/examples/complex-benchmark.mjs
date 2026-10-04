import { performance } from 'node:perf_hooks'
import { cpus } from 'node:os'
import { joinByLocation, clipLines, addGeometryMeasurements } from '@desktop-webgis/spatial-analysis'
import { complexCases, verifyComplexResult } from './complex-fixtures.mjs'

const rows = []
for (const testCase of complexCases(Number(process.argv[2] ?? 1000))) {
  const run = () => testCase.id === 'overlap-join'
    ? joinByLocation(testCase.features, testCase.overlay, testCase.options)
    : testCase.id === 'hole-clip' ? clipLines(testCase.features, testCase.overlay)
    : addGeometryMeasurements(testCase.features, { measurement: 'area', field: 'area_m2', unit: 'square-meters' })
  const before = JSON.stringify(testCase.features)
  run()
  const samples = []
  let result
  for (let repeat = 0; repeat < 3; repeat++) {
    const start = performance.now()
    result = run()
    samples.push(performance.now() - start)
    verifyComplexResult(testCase, result)
  }
  if (JSON.stringify(testCase.features) !== before) throw new Error('Inputs were modified')
  rows.push({ id: testCase.id, inputCount: testCase.features.length, overlayCount: testCase.overlay.length, outputCount: result.length, medianMs: Number(samples.sort((a, b) => a - b)[1].toFixed(3)) })
}
console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, platform: process.platform, data: 'Deterministic synthetic overlaps, holes, 640-vertex polygons; no real business data', warmup: 1, samples: 3, rows }, null, 2))
