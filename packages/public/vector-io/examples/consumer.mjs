import assert from 'node:assert/strict'
import { createCoordinateTransform, reprojectFeatures, pointsToCoordinateCsv, previewCsv } from '@desktop-webgis/vector-io'

const input = [{ id: 'station', geometry: { type: 'Point', coordinates: [1, 1, 10] }, properties: { name: 'Station' } }]
const projected = reprojectFeatures(input, { code: 'EPSG:4326' }, 'EPSG:3857')
assert.ok(Math.abs(projected[0].geometry.coordinates[0] - 111319.49079327357) < 1e-6)
assert.equal(projected[0].geometry.coordinates[2], 10)
assert.deepEqual(input[0].geometry.coordinates, [1, 1, 10])
const csv = pointsToCoordinateCsv(input, { code: 'EPSG:4326' }, { code: 'EPSG:3857' })
assert.equal(previewCsv(csv).declaredCrs, 'EPSG:3857')
const utm = createCoordinateTransform({ code: 'EPSG:4326' }, { proj4: '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs' })
assert.equal(utm.transform([3, 0])[0], 500000)
console.log('Built vector-io exports: projection, Z preservation, coordinate CSV and explicit definitions passed')
