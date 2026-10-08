import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const consumer = mkdtempSync(join(tmpdir(), 'ol-selection-consumer-'))
const packed = mkdtempSync(join(tmpdir(), 'ol-selection-pack-'))
function run(args, cwd = packageRoot) {
  const result = spawnSync('pnpm', args, { cwd, shell: process.platform === 'win32', encoding: 'utf8' })
  if (result.status !== 0) throw new Error([result.stdout, result.stderr].filter(Boolean).join('\n'))
}
run(['build'])
run(['pack', '--pack-destination', packed])
const tarballs = readdirSync(packed).filter(name => name.endsWith('.tgz'))
if (tarballs.length !== 1) throw new Error('Expected one package archive')
writeFileSync(join(consumer, 'package.json'), JSON.stringify({
  name: 'ol-selection-external-consumer', private: true, type: 'module',
  dependencies: { '@desktop-webgis/ol-selection': `file:${join(packed, tarballs[0]).replaceAll('\\', '/')}`, ol: '10.10.0' },
  devDependencies: { typescript: '^5.9.2' }
}, null, 2))
run(['install', '--offline', '--ignore-scripts'], consumer)
const installed = readFileSync(join(consumer, 'node_modules/@desktop-webgis/ol-selection/package.json'), 'utf8')
if (/workspace:|gis-core|ol-runtime/.test(installed)) throw new Error('Unexpected workspace/private dependency')
writeFileSync(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict'
import { applySelection, intersectsSelectionBox } from '@desktop-webgis/ol-selection'
import Point from 'ol/geom/Point.js'
import { fromExtent } from 'ol/geom/Polygon.js'
assert.deepEqual(applySelection([], [{ layerKey: 'a', featureId: 1 }], 'replace'), [{ layerKey: 'a', featureId: 1 }])
assert.equal(intersectsSelectionBox(new Point([0, 0]), fromExtent([-1, -1, 1, 1])), true)
console.log('External tarball Node import/geometry smoke passed')
`)
writeFileSync(join(consumer, 'consumer.ts'), `
import { createSelectionController, type SelectionRequest } from '@desktop-webgis/ol-selection'
import type Map from 'ol/Map.js'
import type VectorLayer from 'ol/layer/Vector.js'
declare const map: Map
declare const layer: VectorLayer
const controller = createSelectionController({ map, targets: [{ layerKey: 'a', layer }],
  onSelectionRequest(request: SelectionRequest) { controller.setSelection(request.selection) } })
controller.setActive(false)
controller.dispose()
`)
run(['exec', 'node', 'smoke.mjs'], consumer)
run(['exec', 'tsc', '--noEmit', '--strict', '--skipLibCheck', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', 'consumer.ts'], consumer)
console.log(`External package import and types passed (OL 10.10.0); artifacts: ${consumer}`)
