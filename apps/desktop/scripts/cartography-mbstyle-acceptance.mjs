import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGeoServerClient, hashLayer } from '@desktop-webgis/ogc-io/geoserver-client'
import { exportMbStyle } from '@desktop-webgis/ogc-io/mbstyle-export'
import { migrateLayerStyle } from '@desktop-webgis/ol-style/cartography-model'
import { chromium } from '@playwright/test'

const base = process.env.CARTOGRAPHY_GEOSERVER_URL
if (base !== 'http://127.0.0.1:18085/geoserver') {
  throw new Error('This acceptance script writes only to the isolated localhost:18085 GeoServer lab')
}
const password = process.env.CARTOGRAPHY_GEOSERVER_PASSWORD
if (!password) throw new Error('Set CARTOGRAPHY_GEOSERVER_PASSWORD for the isolated lab')

const username = process.env.CARTOGRAPHY_GEOSERVER_USER ?? 'admin'
const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
const client = createGeoServerClient(base, (url, request) => fetch(url, {
  ...request,
  headers: { ...request.headers, Authorization: authorization },
  redirect: 'error'
}))
const output = fileURLToPath(new URL('../test-results/cartography-mbstyle-acceptance/', import.meta.url))
await mkdir(output, { recursive: true })

const capability = await client.probeMbStyleSupport()
if (!capability.supported) throw new Error(`MBStyle capability was not confirmed: ${capability.reason}`)
if (capability.serverVersion !== '2.28.2' || capability.moduleName !== 'gs-mbstyle-2.28.2') {
  throw new Error(`Unexpected lab capability: ${JSON.stringify(capability)}`)
}

const workspace = 'sf'
const stores = await client.listStores(workspace)
async function locateFeatureType(name) {
  for (const store of stores) {
    if ((await client.listFeatureTypes(workspace, store)).includes(name)) {
      return { store, featureType: await client.readFeatureType(workspace, store, name) }
    }
  }
  throw new Error(`Lab FeatureType not found: ${name}`)
}

const pointMigration = migrateLayerStyle({
  mode: 'single',
  symbol: {
    type: 'circle', radius: 7,
    fill: { r: 225, g: 87, b: 61, a: 1 },
    stroke: { r: 255, g: 255, b: 255, a: 1 }, strokeWidth: 1.5
  }
}, 'mbstyle-point-fixture', 'sf:bugsites')
const lineMigration = migrateLayerStyle({
  mode: 'single',
  symbol: { type: 'solid', color: { r: 36, g: 117, b: 166, a: 1 }, width: 3.5 }
}, 'mbstyle-line-fixture', 'sf:roads')
const cases = [
  { name: 'migrated-point-circle', layerName: 'bugsites', layers: pointMigration.styleLayers, expectedLayerType: 'circle', expectedColor: [225, 87, 61] },
  { name: 'migrated-line-stroke', layerName: 'roads', layers: lineMigration.styleLayers, expectedLayerType: 'line', expectedColor: [36, 117, 166] }
]
const results = []
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
const page = await browser.newPage()
try { for (const fixture of cases) {
  const { store, featureType } = await locateFeatureType(fixture.layerName)
  const styleName = `mbstyle-${fixture.name}-${Date.now()}`
  const exported = await exportMbStyle(fixture.layers, { name: styleName, strict: true })
  await writeFile(resolve(output, `${fixture.name}.report.json`), JSON.stringify({ level: exported.level, issues: exported.issues }, null, 2))
  if (!exported.publishable || !exported.json) throw new Error(`${fixture.name} was rejected: ${JSON.stringify(exported.issues)}`)

  const document = JSON.parse(exported.json)
  if (document.layers.length !== 1 || document.layers[0].type !== fixture.expectedLayerType) throw new Error(`${fixture.name} did not retain its migrated drawing layer`)
  if (JSON.stringify(document.layers[0].filter) !== JSON.stringify(['==', ['geometry-type'], fixture.expectedLayerType === 'circle' ? 'Point' : 'LineString'])) {
    throw new Error(`${fixture.name} did not retain the geometry-type filter`)
  }
  await writeFile(resolve(output, `${fixture.name}.mbstyle.json`), exported.json)

  const bboxValue = featureType.latLonBoundingBox
  if (!bboxValue || !featureType.srs) throw new Error(`${fixture.name} FeatureType lacks CRS or bounds`)
  const bbox = [bboxValue.minx, bboxValue.miny, bboxValue.maxx, bboxValue.maxy]
  const layer = await client.readLayer(workspace, fixture.layerName)
  const published = await client.publishMbStyle({
    workspace,
    layerName: fixture.layerName,
    styleName,
    mbstyle: exported.json,
    expectedLayerHash: await hashLayer(layer),
    bbox
  })
  const readback = await client.readMbStyle(workspace, published.styleName)
  if (!readback || readback.hash !== published.remoteHash) throw new Error(`${fixture.name} MBStyle readback hash differs`)
  if (!published.map.length || !published.legend.length) throw new Error(`${fixture.name} WMS verification returned no images`)
  const ink = await page.evaluate(async ({ encoded, color }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${encoded}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context unavailable')
    context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let nontransparent = 0, expectedColorPixels = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 0) continue
      nontransparent++
      if (color.every((value, channel) => Math.abs(pixels[index + channel] - value) <= 4)) expectedColorPixels++
    }
    return { width: image.width, height: image.height, nontransparent, expectedColorPixels }
  }, { encoded: Buffer.from(published.map).toString('base64'), color: fixture.expectedColor })
  if (ink.width !== 256 || ink.height !== 256 || !ink.nontransparent || !ink.expectedColorPixels) {
    throw new Error(`${fixture.name} WMS PNG did not contain expected rendered pixels: ${JSON.stringify(ink)}`)
  }
  await writeFile(resolve(output, `${fixture.name}.remote.json`), readback.content)
  await writeFile(resolve(output, `${fixture.name}.wms.png`), published.map)
  await writeFile(resolve(output, `${fixture.name}.legend.png`), published.legend)
  results.push({
    name: fixture.name,
    workspace,
    store,
    targetLayer: fixture.layerName,
    targetCrs: featureType.srs,
    featureTypeBounds: bbox,
    styleName: published.styleName,
    drawingLayerType: document.layers[0].type,
    geometryFilter: document.layers[0].filter,
    decodedWmsPixels: ink,
    compatibility: exported.level,
    remoteHash: published.remoteHash,
    steps: published.steps
  })
  console.log(`PASS ${fixture.name}: upload/readback/WMS (${ink.expectedColorPixels} expected-color pixels), geometry guard retained`)
} } finally { await browser.close() }

// Categorized migration uses a `typeof` guard. It must remain unavailable until
// an equivalent server-side type test is proven; do not strip the guard.
const categorizedMigration = migrateLayerStyle({
  mode: 'categorized',
  field: 'cat',
  categories: [{ value: 1, symbol: { type: 'solid', color: { r: 200, g: 40, b: 50, a: 1 }, width: 2 } }],
  fallback: { type: 'solid', color: { r: 80, g: 80, b: 80, a: 1 }, width: 1 }
}, 'mbstyle-category-unsupported', 'sf:roads')
const categorized = await exportMbStyle(categorizedMigration.styleLayers, { name: 'categorized-probe', strict: true })
const categoryReport = { level: categorized.level, publishable: categorized.publishable, issues: categorized.issues }
await writeFile(resolve(output, 'migrated-category-expected-unsupported.json'), JSON.stringify(categoryReport, null, 2))
if (categorized.publishable || categorized.json !== undefined || !categorized.issues.some(issue => issue.path.endsWith('/filter') && issue.level === 'unsupported')) {
  throw new Error('Categorized migration with typeof guard was not explicitly rejected')
}

await writeFile(resolve(output, 'results.json'), JSON.stringify({
  server: capability,
  probe: { method: 'GET version + manifest only', mutations: 0 },
  positiveCases: results,
  negativeCase: { name: 'migrated-categorized-typeof-guard', result: 'unsupported; no publish request was made' },
  evidenceScope: 'Real GeoServer 2.28.2 REST MBStyle upload/readback and WMS; browser decoded 256x256 PNG pixels for visible and expected-color counts. This is not native Desktop or pixel-equivalence acceptance.'
}, null, 2))
console.log(`Wrote acceptance evidence to ${output}`)
