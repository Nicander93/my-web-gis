import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// Run after packing the six libraries into .artifacts/packages. This project
// deliberately lives outside pnpm workspace membership and uses tarballs only.
const names = ['cesium-popup', 'cesium-scene-schema', 'cesium-layer', 'cesium-tileset-edit', 'cesium-effects', 'cesium-scene-runtime']
const target = new URL('../.artifacts/packed-consumer/', import.meta.url)
await mkdir(target, { recursive: true })
const dependencies = Object.fromEntries(names.map(name => [`@desktop-webgis/${name}`, `file:${fileURLToPath(new URL(`../.artifacts/packages/desktop-webgis-${name}-0.1.0.tgz`, import.meta.url)).replaceAll('\\', '/')}`]))
dependencies.cesium = '^1.145.0'
const overrides = Object.fromEntries(Object.entries(dependencies).filter(([name]) => name !== 'cesium'))
await writeFile(new URL('package.json', target), JSON.stringify({ name: 'packed-city-consumer-smoke', private: true, type: 'module', dependencies }, null, 2))
await writeFile(new URL('pnpm-workspace.yaml', target), `packages:\n  - .\noverrides:\n${Object.entries(overrides).map(([name, url]) => `  ${JSON.stringify(name)}: ${JSON.stringify(url)}`).join('\n')}\n`)
await writeFile(new URL('smoke.mjs', target), `
import assert from 'node:assert/strict'
import { createCityScene, parseCityScene } from '@desktop-webgis/cesium-scene-schema'
import { Popup } from '@desktop-webgis/cesium-popup'
import { LayerCollection, TilesetLayer } from '@desktop-webgis/cesium-layer'
import { TilesetEditor } from '@desktop-webgis/cesium-tileset-edit'
import { CityEffects, WaterLayer } from '@desktop-webgis/cesium-effects'
import { CitySceneRuntime } from '@desktop-webgis/cesium-scene-runtime'
for (const api of [Popup, LayerCollection, TilesetLayer, TilesetEditor, CityEffects, WaterLayer, CitySceneRuntime]) assert.equal(typeof api, 'function')
assert.deepEqual(parseCityScene(createCityScene()), createCityScene())
console.log('Six packed ESM packages import successfully without application dependencies.')
`)
