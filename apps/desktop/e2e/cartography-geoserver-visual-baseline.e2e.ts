import { expect, test } from '@playwright/test'
import { createGeoServerClient, type GeoServerRequest, type GeoServerTransport } from '@desktop-webgis/ogc-io/geoserver-client'
import { exportSld } from '@desktop-webgis/ogc-io/sld-export'
import { BUILTIN_SYMBOL_PRESETS } from '@desktop-webgis/ol-style/symbol-library'
import type { MapLibreStyleSpecification } from '@desktop-webgis/ol-style/cartography'
import { transform } from 'ol/proj.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const baseUrl = process.env.CARTOGRAPHY_GEOSERVER_URL ?? 'http://127.0.0.1:18085/geoserver'
const username = process.env.CARTOGRAPHY_GEOSERVER_USER ?? 'admin'
const password = process.env.CARTOGRAPHY_GEOSERVER_PASSWORD
const workspace = 'sf'
const imageSize = 256
const outputDirectory = resolve('..', '..', 'docs/design/2d-cartography-geoserver/baseline/geoserver-2.28.2')

interface FeatureTypeResponse {
  featureType: {
    name: string
    srs?: string
    attributes?: { attribute: Array<{ name: string; binding: string }> }
    latLonBoundingBox?: { minx: number; miny: number; maxx: number; maxy: number }
  }
}

interface WfsFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{ type: 'Feature'; geometry: unknown; properties: Record<string, unknown>; id?: string | number }>
}

const primaryRoadPreset = BUILTIN_SYMBOL_PRESETS.find(preset => preset.id === 'builtin:road-primary-v1')
if (!primaryRoadPreset) throw new Error('Versioned builtin primary road preset is missing')

const visualCases: Array<{ id: string; target: string; layers: MapLibreStyleSpecification['layers'] }> = [
  {
    id: 'roads-solid-stroke',
    target: 'roads',
    layers: [{ id: 'solid', source: 'wfs-fixture', type: 'line', paint: { 'line-color': '#cc563f', 'line-width': 4.5 }, layout: { 'line-cap': 'round', 'line-join': 'round' } }]
  },
  {
    id: 'roads-dashed-stroke',
    target: 'roads',
    layers: [{ id: 'dashed', source: 'wfs-fixture', type: 'line', paint: { 'line-color': '#59477c', 'line-width': 3.5, 'line-dasharray': [5, 2] }, layout: { 'line-cap': 'butt', 'line-join': 'round' } }]
  },
  {
    id: 'restricted-transparent-fill',
    target: 'restricted',
    layers: [{ id: 'transparent-fill', source: 'wfs-fixture', type: 'fill', paint: { 'fill-color': '#36a978', 'fill-opacity': 0.34, 'fill-outline-color': '#146647' } }]
  },
  {
    id: 'roads-text-halo',
    target: 'roads',
    layers: [{
      id: 'text-halo', type: 'symbol',
      source: 'wfs-fixture',
      layout: { 'text-field': ['get', 'label'], 'text-font': ['SansSerif'], 'text-size': 13, 'symbol-placement': 'line' },
      paint: { 'text-color': '#25221f', 'text-halo-color': '#fffdf7', 'text-halo-width': 2.25 }
    }]
  },
  {
    id: 'roads-builtin-primary-casing-order',
    target: 'roads',
    layers: primaryRoadPreset.layers.map(layer => ({ ...structuredClone(layer), source: 'wfs-fixture' }))
  }
]

function featureTypeField(featureType: FeatureTypeResponse['featureType'], predicate: RegExp): string | undefined {
  return featureType.attributes?.attribute.find(attribute => predicate.test(attribute.binding))?.name
}

function squareWebMercatorBounds(bounds: NonNullable<FeatureTypeResponse['featureType']['latLonBoundingBox']>): [number, number, number, number] {
  const lower = transform([bounds.minx, bounds.miny], 'EPSG:4326', 'EPSG:3857')
  const upper = transform([bounds.maxx, bounds.maxy], 'EPSG:4326', 'EPSG:3857')
  const side = Math.max(upper[0] - lower[0], upper[1] - lower[1]) * 1.04
  const centerX = (upper[0] + lower[0]) / 2
  const centerY = (upper[1] + lower[1]) / 2
  return [centerX - side / 2, centerY - side / 2, centerX + side / 2, centerY + side / 2]
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 32 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
}

test('archives paired OpenLayers Canvas and real GeoServer WMS images for shared WFS data and map scale', async ({ page }) => {
  test.skip(!password, 'Set CARTOGRAPHY_GEOSERVER_PASSWORD to run against the isolated GeoServer 2.28.2 lab')
  expect(baseUrl).toBe('http://127.0.0.1:18085/geoserver')
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`
  const transport: GeoServerTransport = async (url: string, request: GeoServerRequest) => fetch(url, {
    method: request.method,
    headers: { ...request.headers, Authorization: authorization },
    ...(request.body ? { body: request.body as BodyInit } : {}),
    ...(request.signal ? { signal: request.signal } : {}),
    redirect: 'error'
  })
  const client = createGeoServerClient(baseUrl, transport)
  const versionResponse = await fetch(`${baseUrl}/rest/about/version.json`, { headers: { Authorization: authorization }, redirect: 'error' })
  expect(versionResponse.ok, 'GeoServer version endpoint must respond').toBeTruthy()
  const serverVersion: unknown = await versionResponse.json()
  expect(JSON.stringify(serverVersion)).toContain('2.28.2')

  const stores = await client.listStores(workspace)
  const targetDetails = new Map<string, { store: string; featureType: FeatureTypeResponse['featureType'] }>()
  for (const target of new Set(visualCases.map(item => item.target))) {
    let found: { store: string; featureType: FeatureTypeResponse['featureType'] } | undefined
    for (const store of stores) {
      if (!(await client.listFeatureTypes(workspace, store)).includes(target)) continue
      const response = await fetch(`${baseUrl}/rest/workspaces/${workspace}/datastores/${store}/featuretypes/${target}.json`, { headers: { Authorization: authorization }, redirect: 'error' })
      if (!response.ok) throw new Error(`Could not read fixture ${workspace}:${target}`)
      found = { store, featureType: (await response.json() as FeatureTypeResponse).featureType }
      break
    }
    if (!found) throw new Error(`GeoServer lab fixture is missing ${workspace}:${target}`)
    targetDetails.set(target, found)
  }

  const fixtures = new Map<string, { geojson: WfsFeatureCollection; featureType: FeatureTypeResponse['featureType']; extent: [number, number, number, number]; geometryField?: string; fieldTypes: Record<string, 'string' | 'number' | 'boolean'>; store: string }>()
  for (const [target, detail] of targetDetails) {
    const featureType = detail.featureType
    if (!featureType.latLonBoundingBox || !featureType.srs) throw new Error(`${workspace}:${target} must expose CRS and WGS84 bounds`)
    const params = new URLSearchParams({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: `${workspace}:${target}`,
      outputFormat: 'application/json', srsName: 'EPSG:4326'
    })
    const response = await fetch(`${baseUrl}/wfs?${params}`, { headers: { Authorization: authorization, Accept: 'application/json' }, redirect: 'error' })
    if (!response.ok) throw new Error(`WFS GetFeature failed for ${workspace}:${target}: HTTP ${response.status}`)
    const geojson = await response.json() as WfsFeatureCollection
    if (geojson.type !== 'FeatureCollection' || !geojson.features.length) throw new Error(`WFS returned no features for ${workspace}:${target}`)
    const fieldTypes: Record<string, 'string' | 'number' | 'boolean'> = {}
    for (const attribute of featureType.attributes?.attribute ?? []) {
      const binding = attribute.binding.toLowerCase()
      if (/string|char/.test(binding)) fieldTypes[attribute.name] = 'string'
      else if (/numeric|integer|double|float|long|short|bigdecimal|biginteger/.test(binding)) fieldTypes[attribute.name] = 'number'
      else if (/boolean/.test(binding)) fieldTypes[attribute.name] = 'boolean'
    }
    fixtures.set(target, {
      geojson,
      featureType,
      extent: squareWebMercatorBounds(featureType.latLonBoundingBox),
      geometryField: featureTypeField(featureType, /geometry|point|linestring|polygon/i),
      fieldTypes,
      store: detail.store
    })
  }

  await page.goto('/cartography-visual-baseline.html')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'true')
  await mkdir(outputDirectory, { recursive: true })
  const results: Array<Record<string, unknown>> = []

  for (const fixture of visualCases) {
    const target = fixtures.get(fixture.target)!
    const layers = fixture.layers
    const exported = exportSld(layers as never, {
      targetLayerName: fixture.target,
      crs: target.featureType.srs!,
      ...(target.geometryField ? { geometryField: target.geometryField } : {}),
      fieldTypes: target.fieldTypes,
      strict: true
    })
    if (!exported.publishable || !exported.sldXml) throw new Error(`${fixture.id} SLD export is not publishable: ${JSON.stringify(exported.issues)}`)
    const featureTypeStyleOrder = [...exported.sldXml.matchAll(/<sld:FeatureTypeStyle>\s*<sld:Name>([^<]+)<\/sld:Name>/g)].map(match => match[1])
    if (fixture.id === 'roads-builtin-primary-casing-order') expect(featureTypeStyleOrder).toEqual(['casing', 'surface'])

    await page.evaluate(async input => window.renderCartographyBaseline(input), {
      geojson: target.geojson,
      layers,
      extent: target.extent
    })
    const openLayersPath = resolve(outputDirectory, `${fixture.id}.openlayers.png`)
    await page.locator('#map').screenshot({ path: openLayersPath, omitBackground: true })

    const [minX, minY, maxX, maxY] = target.extent
    const styleName = `visual-baseline-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
    const styleUrl = `${baseUrl}/rest/workspaces/${workspace}/styles?name=${encodeURIComponent(styleName)}`
    const createStyle = await fetch(styleUrl, {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/vnd.ogc.sld+xml', Accept: 'application/json' },
      body: exported.sldXml,
      redirect: 'error'
    })
    if (!createStyle.ok) throw new Error(`GeoServer could not load exported SLD for ${fixture.id}: HTTP ${createStyle.status} ${(await createStyle.text()).slice(0, 500)}`)

    let wmsBytes: Uint8Array
    try {
      const params = new URLSearchParams({
        service: 'WMS', version: '1.3.0', request: 'GetMap', layers: `${workspace}:${fixture.target}`, styles: styleName,
        crs: 'EPSG:3857', bbox: [minX, minY, maxX, maxY].join(','), width: String(imageSize), height: String(imageSize),
        format: 'image/png', transparent: 'true'
      })
      const wmsResponse = await fetch(`${baseUrl}/wms?${params}`, { headers: { Authorization: authorization, Accept: 'image/png' }, redirect: 'error' })
      if (!wmsResponse.ok) throw new Error(`GeoServer WMS GetMap failed for ${fixture.id}: HTTP ${wmsResponse.status} ${(await wmsResponse.text()).slice(0, 500)}`)
      const contentType = wmsResponse.headers.get('content-type') ?? ''
      if (!contentType.toLowerCase().startsWith('image/png')) throw new Error(`GeoServer returned ${contentType} instead of PNG for ${fixture.id}`)
      wmsBytes = new Uint8Array(await wmsResponse.arrayBuffer())
      if (!isPng(wmsBytes)) throw new Error(`GeoServer returned invalid PNG for ${fixture.id}`)
    } finally {
      const deleteStyle = await fetch(`${baseUrl}/rest/workspaces/${workspace}/styles/${encodeURIComponent(styleName)}?purge=true&recurse=false`, {
        method: 'DELETE', headers: { Authorization: authorization }, redirect: 'error'
      })
      if (!deleteStyle.ok && deleteStyle.status !== 404) throw new Error(`GeoServer could not remove temporary visual baseline style (${deleteStyle.status})`)
    }
    const wmsPath = resolve(outputDirectory, `${fixture.id}.geoserver-wms.png`)
    await writeFile(wmsPath, wmsBytes)

    const pairData = await page.evaluate(async ({ localPng, remotePng }) => {
      const read = async (data: string) => {
        const image = new Image()
        image.src = data
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return { canvas, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data }
      }
      const local = await read(localPng)
      const remote = await read(remotePng)
      if (local.canvas.width !== remote.canvas.width || local.canvas.height !== remote.canvas.height) throw new Error('Paired images have different pixel dimensions')
      const diff = document.createElement('canvas')
      diff.width = local.canvas.width
      diff.height = local.canvas.height
      const context = diff.getContext('2d')!
      const data = context.createImageData(diff.width, diff.height)
      let absolute = 0, differing = 0
      for (let index = 0; index < local.pixels.length; index += 4) {
        let distance = 0
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(local.pixels[index + channel]! - remote.pixels[index + channel]!)
          absolute += delta
          distance += delta
        }
        if (distance > 24) differing++
        const intensity = Math.min(255, distance)
        data.data[index] = intensity
        data.data[index + 1] = Math.max(0, 80 - intensity / 4)
        data.data[index + 2] = 0
        data.data[index + 3] = Math.max(local.pixels[index + 3]!, remote.pixels[index + 3]!, intensity ? 180 : 0)
      }
      context.putImageData(data, 0, 0)
      return {
        width: diff.width,
        height: diff.height,
        meanAbsoluteChannelDifference: absolute / local.pixels.length,
        pixelsOverThreshold: differing,
        differencePng: diff.toDataURL('image/png')
      }
    }, {
      localPng: `data:image/png;base64,${Buffer.from(await readFile(openLayersPath)).toString('base64')}`,
      remotePng: `data:image/png;base64,${Buffer.from(wmsBytes).toString('base64')}`
    })
    const diffPath = resolve(outputDirectory, `${fixture.id}.difference.png`)
    await writeFile(diffPath, Buffer.from(pairData.differencePng.slice(pairData.differencePng.indexOf(',') + 1), 'base64'))
    await writeFile(resolve(outputDirectory, `${fixture.id}.sld`), exported.sldXml)

    const featureDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(target.geojson)))
    results.push({
      id: fixture.id,
      target: `${workspace}:${fixture.target}`,
      temporarySldResource: 'uploaded for WMS render and deleted after response',
      store: target.store,
      crs: 'EPSG:3857',
      extent: target.extent,
      width: imageSize,
      height: imageSize,
      pixelRatio: 1,
      wfsFeatureCount: target.geojson.features.length,
      wfsFeatureCollectionSha256: [...new Uint8Array(featureDigest)].map(value => value.toString(16).padStart(2, '0')).join(''),
      mapLibreStyleLayers: layers,
      ...(fixture.id === 'roads-builtin-primary-casing-order' ? { featureTypeStyleOrder } : {}),
      sldCompatibility: exported.level,
      issues: exported.issues,
      openLayersPng: `${fixture.id}.openlayers.png`,
      geoServerWmsPng: `${fixture.id}.geoserver-wms.png`,
      differencePng: `${fixture.id}.difference.png`,
      differenceMetrics: { meanAbsoluteChannelDifference: pairData.meanAbsoluteChannelDifference, pixelsOverThreshold: pairData.pixelsOverThreshold },
      note: 'Difference metrics record renderer divergence; they are not a pixel-equivalence acceptance threshold.'
    })
  }

  await writeFile(resolve(outputDirectory, 'run-metadata.json'), JSON.stringify({
    geoserverVersion: serverVersion,
    generatedAt: new Date().toISOString(),
    endpoint: baseUrl,
    workspace,
    dimensions: { width: imageSize, height: imageSize, pixelRatio: 1 },
    renderingPath: 'GeoServer WFS GeoJSON -> OpenLayers EPSG:3857 VectorSource -> createMapLibreCanvasBinding; same WFS FeatureCollection -> SLD 1.0 exporter -> REST temporary named-style upload -> GeoServer WMS GetMap with STYLES -> temporary-style cleanup',
    cases: results,
    caveats: ['This is browser Chromium Canvas evidence, not native Tauri evidence.', 'The images share WFS data per target, projected extent, CRS, pixel dimensions, and pixel ratio; renderer/text/font and SLD semantics may differ.', 'No visual equivalence or acceptance threshold is claimed.']
  }, null, 2))
  expect(results).toHaveLength(visualCases.length)
})
