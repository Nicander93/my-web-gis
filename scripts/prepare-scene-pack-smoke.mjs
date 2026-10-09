import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const names = ['cesium-scene-schema', 'scene-schema', 'scene-core']
const target = new URL('../.artifacts/scene-packed-consumer/', import.meta.url)
await mkdir(new URL('../.artifacts/scene-packages/', import.meta.url), { recursive: true })
await mkdir(target, { recursive: true })
const dependencies = Object.fromEntries(names.map(name => [`@desktop-webgis/${name}`, `file:${fileURLToPath(new URL(`../.artifacts/scene-packages/desktop-webgis-${name}-0.1.0.tgz`, import.meta.url)).replaceAll('\\', '/')}`]))
await writeFile(new URL('package.json', target), JSON.stringify({ name: 'scene-packed-consumer', private: true, type: 'module', dependencies }, null, 2))
await writeFile(new URL('pnpm-workspace.yaml', target), `packages:\n  - .\noverrides:\n${Object.entries(dependencies).map(([name, url]) => `  ${JSON.stringify(name)}: ${JSON.stringify(url)}`).join('\n')}\n`)
await writeFile(new URL('consumer.ts', target), `
import { createSceneDocument, mergeSceneDocuments, prepareSceneGeoJsonResources, type SceneMergeResult } from '@desktop-webgis/scene-core'
import { parseSceneDocument, type SceneDocument } from '@desktop-webgis/scene-schema'
const scene: SceneDocument = createSceneDocument({ id: 'consumer', title: 'Consumer', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } })
const result: SceneMergeResult = mergeSceneDocuments(scene, scene)
const parsed: SceneDocument = parseSceneDocument(result.document)
const prepared: Promise<SceneDocument> = prepareSceneGeoJsonResources(parsed, { loadGeoJson: async (_url, context) => { context.signal?.throwIfAborted(); return { type: 'FeatureCollection', features: [] } } })
void prepared
`)
await writeFile(new URL('smoke.mjs', target), `
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSceneDocument, mergeSceneDocuments, prepareSceneGeoJsonResources, serializeSceneDocument } from '@desktop-webgis/scene-core'
import { parseSceneDocument } from '@desktop-webgis/scene-schema'
const schema = JSON.parse(await readFile(new URL(import.meta.resolve('@desktop-webgis/scene-schema/scene-document.schema.json')), 'utf8'))
assert.equal(schema.properties.version.const, 3)
const document = createSceneDocument({ id: 'consumer', title: 'Consumer', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } })
document.resources.points = { type: 'geojson', url: './points.geojson' }
const prepared = await prepareSceneGeoJsonResources(document, { loadGeoJson: async () => ({ type: 'FeatureCollection', features: [] }) })
assert.equal(prepared.resources.points.data.features.length, 0)
const merged = mergeSceneDocuments(prepared, prepared)
assert.equal(merged.ids.resources.points, 'points-2')
assert.equal(merged.ids.views.map, 'map-2')
assert.deepEqual(parseSceneDocument(serializeSceneDocument(merged.document)), merged.document)
for (const name of ${JSON.stringify(names)}) {
  const manifest = JSON.parse(await readFile(new URL('./node_modules/@desktop-webgis/' + name + '/package.json', import.meta.url), 'utf8'))
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const value of Object.values(manifest[section] ?? {})) assert.ok(!value.startsWith('workspace:'), name + ' leaked workspace protocol')
  }
}
console.log('Packed v3 schema, resource preparation and merge APIs passed without source aliases.')
`)
