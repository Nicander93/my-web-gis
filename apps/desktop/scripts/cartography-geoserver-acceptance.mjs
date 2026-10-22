import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createGeoServerClient, hashLayer } from '@desktop-webgis/ogc-io/geoserver-client'
import { exportSld } from '@desktop-webgis/ogc-io/sld-export'
import { encodeSldPackage } from '@desktop-webgis/ogc-io/sld-package'
import { createStyleAsset } from '@desktop-webgis/ol-style/style-assets'
import { migrateLayerStyle } from '@desktop-webgis/ol-style/cartography-model'
import { BUILTIN_SYMBOL_PRESETS } from '@desktop-webgis/ol-style/symbol-library'
import { chromium } from '@playwright/test'

const base = process.env.CARTOGRAPHY_GEOSERVER_URL
if (!base || !/^http:\/\/127\.0\.0\.1:18085\/geoserver\/?$/.test(base)) throw new Error('This acceptance script writes only to the isolated localhost:18085 GeoServer lab')
if (!process.env.CARTOGRAPHY_GEOSERVER_PASSWORD) throw new Error('Lab password is required in the environment')
const authorization = `Basic ${Buffer.from(`${process.env.CARTOGRAPHY_GEOSERVER_USER ?? 'admin'}:${process.env.CARTOGRAPHY_GEOSERVER_PASSWORD}`).toString('base64')}`
const client = createGeoServerClient(base, (url, request) => fetch(url, { ...request, headers: { ...request.headers, Authorization: authorization }, redirect: 'error' }))
const output = resolve('test-results/cartography-geoserver-acceptance')
await mkdir(output, { recursive: true })
const versionResponse = await fetch(`${base}/rest/about/version.json`, { headers: { Authorization: authorization } })
const version = await versionResponse.json()
const stores = await client.listStores('sf')
async function target(name) {
  for (const store of stores) if ((await client.listFeatureTypes('sf', store)).includes(name)) return { store, featureType: await client.readFeatureType('sf', store, name) }
  throw new Error(`Fixture FeatureType not found: ${name}`)
}
const marker = await createStyleAsset({ name: 'lab-marker.svg', mimeType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#e76433"/></svg>'), attribution: { source: 'my-web-gis acceptance fixture', license: 'CC0-1.0' } })
const pattern = await createStyleAsset({ name: 'lab-pattern.svg', mimeType: 'image/svg+xml', bytes: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#f3eee4"/><path d="M0 16L16 0" stroke="#b2986e" stroke-width="2"/></svg>'), attribution: { source: 'my-web-gis acceptance fixture', license: 'CC0-1.0' } })
const road = BUILTIN_SYMBOL_PRESETS.find(preset => preset.id === 'builtin:road-primary-v1')
const cases = [
  { name: 'road-casing', layer: 'roads', layers: road.layers },
  { name: 'river', layer: 'streams', layers: BUILTIN_SYMBOL_PRESETS.find(preset => preset.id === 'builtin:river-v1').layers },
  { name: 'boundary', layer: 'restricted', layers: BUILTIN_SYMBOL_PRESETS.find(preset => preset.id === 'builtin:boundary-v1').layers },
  { name: 'dash', layer: 'roads', layers: [{ id: 'dash', source: 'source', type: 'line', paint: { 'line-color': '#7c4c93', 'line-width': 4, 'line-dasharray': [3, 2] }, layout: { 'line-cap': 'butt', 'line-join': 'round' } }] },
  { name: 'label-halo', layer: 'roads', layers: [...road.layers, { id: 'label', source: 'preset', type: 'symbol', layout: { 'text-field': 'Road', 'text-size': 14, 'text-font': ['SansSerif'], 'symbol-placement': 'line' }, paint: { 'text-color': '#222222', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } }] },
  { name: 'svg-icon', layer: 'bugsites', expectedColor: [231,100,51], assets: [marker], layers: [{ id: 'icon', source: 'source', type: 'symbol', layout: { 'icon-image': marker.id, 'icon-size': 1 } }] },
  { name: 'fill-pattern', layer: 'restricted', expectedColor: [243,238,228], assets: [pattern], layers: [{ id: 'pattern', source: 'source', type: 'fill', paint: { 'fill-pattern': pattern.id, 'fill-opacity': 0.8 } }] },
  { name: 'migrated-category', layer: 'roads', layers: migrateLayerStyle({ mode: 'categorized', field: 'cat', categories: [{ value: 1, symbol: { type: 'solid', color: { r: 255, g: 0, b: 0, a: 1 }, width: 4 } }], fallback: { type: 'solid', color: { r: 0, g: 0, b: 255, a: 1 }, width: 2 } }, 'roads', 'roads').styleLayers },
  { name: 'migrated-graduated', layer: 'roads', layers: migrateLayerStyle({ mode: 'graduated', field: 'cat', method: 'manual', breaks: [{ value: 2, symbol: { type: 'solid', color: { r: 255, g: 0, b: 0, a: 1 }, width: 4 } }, { value: 4, symbol: { type: 'solid', color: { r: 0, g: 0, b: 255, a: 1 }, width: 2 } }], fallback: { type: 'solid', color: { r: 90, g: 90, b: 90, a: 1 }, width: 1 } }, 'roads', 'roads').styleLayers },
  { name: 'zoom-preview', layer: 'roads', previewZoom: 10, layers: [{ id: 'zoom-road', source: 'source', type: 'line', minzoom: 6, maxzoom: 14, paint: { 'line-color': '#2874a0', 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 2, 20, 10] } }] },
  { name: 'field-width', layer: 'roads', layers: [{ id: 'field-road', source: 'source', type: 'line', paint: { 'line-color': '#237d53', 'line-width': ['*', ['number', ['get', 'cat'], 0], 0.75] } }] },
]
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
const page = await browser.newPage()
const results = []
try {
  for (const fixture of cases) {
    const { store, featureType } = await target(fixture.layer)
    const attributes = featureType.attributes?.attribute ?? []
    const geometryField = attributes.find(attribute => /geom|Point|LineString|Polygon/.test(attribute.binding))?.name
    const fieldTypes = Object.fromEntries(attributes.flatMap(attribute => /String|Char/.test(attribute.binding) ? [[attribute.name, 'string']] : /Number|Integer|Long|Short|Double|Float|Decimal/.test(attribute.binding) ? [[attribute.name, 'number']] : /Boolean/.test(attribute.binding) ? [[attribute.name, 'boolean']] : []))
    const styleName = `cartography-${fixture.name}`
    const exported = exportSld(fixture.layers, { targetLayerName: styleName, crs: featureType.srs, geometryField, fieldTypes, assets: fixture.assets, strict: true, ...(fixture.previewZoom === undefined ? {} : { previewZoom: fixture.previewZoom }) })
    await writeFile(resolve(output, `${fixture.name}.report.json`), JSON.stringify(exported.issues, null, 2))
    if (!exported.publishable || !exported.sldXml) throw new Error(`Unsupported ${fixture.name}: ${JSON.stringify(exported.issues)}`)
    await writeFile(resolve(output, `${fixture.name}.sld`), exported.sldXml)
    const remote = await client.readStyle('sf', styleName)
    const layer = await client.readLayer('sf', fixture.layer)
    const bounds = featureType.latLonBoundingBox
    const bbox = [bounds.minx, bounds.miny, bounds.maxx, bounds.maxy]
    const result = await client.publish({ workspace: 'sf', layerName: fixture.layer, styleName, sld: exported.sldXml, expectedRemoteHash: remote?.hash, expectedLayerHash: await hashLayer(layer), ...(exported.assets.length ? { packageBytes: await encodeSldPackage(exported) } : {}), bbox })
    await writeFile(resolve(output, `${fixture.name}.remote.sld`), (await client.readStyle('sf', result.styleName)).content)
    if (remote && !remote.etag) {
      if (result.styleName === styleName || (await client.readStyle('sf', styleName))?.hash !== remote.hash) throw new Error(`Existing style was not preserved: ${fixture.name}`)
    }
    await writeFile(resolve(output, `${fixture.name}.wms.png`), result.map)
    await writeFile(resolve(output, `${fixture.name}.legend.png`), result.legend)
    const ink = await page.evaluate(async ({ encoded, color }) => {
      const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let visible = 0, expectedColorPixels = 0
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) {
        visible++
        if (color && color.every((value, channel) => Math.abs(pixels[index - 3 + channel] - value) <= 2)) expectedColorPixels++
      }
      return { width: image.width, height: image.height, nontransparent: visible, expectedColorPixels }
    }, { encoded: Buffer.from(result.map).toString('base64'), color: fixture.expectedColor })
    if (!ink.nontransparent) throw new Error(`WMS returned an empty rendering: ${fixture.name}`)
    if (fixture.expectedColor && !ink.expectedColorPixels) throw new Error(`WMS did not render the actual image asset: ${fixture.name}`)
    results.push({ name: fixture.name, target: `sf:${fixture.layer}`, styleName: result.styleName, oldStylePreserved: !!remote && !remote.etag, store, geometryField, compatibility: exported.level, ink, remoteHash: result.remoteHash, steps: result.steps })
    console.log(`PASS ${fixture.name} (${ink.nontransparent} visible pixels)`)
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ version, results, evidence: 'Real GeoServer REST upload/readback/association and decoded WMS/legend PNG; no native Desktop or visual-equivalence claim' }, null, 2))
} finally { await browser.close() }
