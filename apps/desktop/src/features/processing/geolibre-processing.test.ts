import { beforeAll, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { initTools } from 'geolibre-wasm/tools'
import type { GisFeature } from '@desktop-webgis/gis-core'
import { simplifyFeatures } from './geolibre-processing'

const options = { tool: 'simplify', tolerance: .0001, unit: 'degrees' } as const
function line(): GisFeature {
  return { id: 'line-1', geometry: { type: 'LineString', coordinates: [[116, 39], [116.001, 39.00001], [116.002, 39]] },
    properties: { name: '中文', value: 42, flag: true, nested: { list: [1, null, false] }, missing: null, source_index: 'original' }, metadata: { sourceId: 'upstream' } }
}

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  await initTools(await readFile(join(dirname(require.resolve('geolibre-wasm/tools')), 'geolibre-cli.wasm')))
}, 30_000)

it('runs the real WASI tool, reduces vertices and preserves original typed properties and provenance', async () => {
  const input = [line()], before = structuredClone(input)
  const result = await simplifyFeatures(input, options)
  expect(result.engine).toEqual({ id: 'geolibre-wasm', version: '1.7.1', tool: 'simplify_features' })
  expect(result.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[116, 39], [116.002, 39]] })
  expect(result.features[0].id).not.toBe(input[0].id)
  expect(result.features[0].metadata?.sourceId).toBe(input[0].id)
  expect(result.features[0].properties).toEqual(input[0].properties)
  result.features[0].properties.nested = { changed: true }
  expect(input).toEqual(before)
})

it('keeps multipart order, multiple input identities, polygon closure and holes', async () => {
  const multi = line(); multi.id = 'multi'; multi.geometry = { type: 'MultiLineString', coordinates: [line().geometry.coordinates as [number, number][], [[117, 39], [117.001, 39.00001], [117.002, 39]]] }
  const polygon: GisFeature = { id: 'area', properties: { name: '有孔面' }, geometry: { type: 'Polygon', coordinates: [
    [[116, 39], [116.001, 39.00001], [116.01, 39], [116.01, 39.01], [116, 39.01], [116, 39]],
    [[116.002, 39.002], [116.004, 39.002], [116.004, 39.004], [116.002, 39.004], [116.002, 39.002]]
  ] } }
  const result = await simplifyFeatures([multi, polygon], options)
  expect(result.features.map(feature => feature.metadata?.sourceId)).toEqual(['multi', 'area'])
  expect(result.features.map(feature => feature.properties)).toEqual([multi.properties, polygon.properties])
  expect(result.features[0].geometry.type).toBe('MultiLineString')
  const geometry = result.features[1].geometry
  expect(geometry.type).toBe('Polygon')
  if (geometry.type !== 'Polygon') throw new Error('Expected polygon')
  expect(geometry.coordinates).toHaveLength(2)
  for (const ring of geometry.coordinates) expect(ring.at(-1)).toEqual(ring[0])
})

it.each([0, -1, NaN, Infinity, 181])('rejects invalid tolerance %s without changing input', async tolerance => {
  const input = [line()], before = structuredClone(input)
  await expect(simplifyFeatures(input, { ...options, tolerance })).rejects.toThrow('简化容差')
  expect(input).toEqual(before)
})

it('rejects Z, unsupported points and dateline inputs explicitly', async () => {
  const z = line(); z.geometry = { type: 'LineString', coordinates: [[116, 39, 2], [116.001, 39, 3]] }
  await expect(simplifyFeatures([z], options)).rejects.toThrow('Z/M')
  const point = line(); point.geometry = { type: 'Point', coordinates: [116, 39] }
  await expect(simplifyFeatures([point], options)).rejects.toThrow('仅支持线和面')
  const crossing = line(); crossing.geometry = { type: 'LineString', coordinates: [[179, 39], [-179, 39]] }
  await expect(simplifyFeatures([crossing], options)).rejects.toThrow('日期变更线')
})

it('retains a valid polygon when the upstream algorithm declines a collapsing simplification', async () => {
  const polygon: GisFeature = { id: 'collapse', properties: {}, geometry: { type: 'Polygon', coordinates: [[[116, 39], [116.001, 39], [116.001, 39.001], [116, 39]]] } }
  const before = structuredClone(polygon)
  const result = await simplifyFeatures([line(), polygon], { ...options, tolerance: 1 })
  expect(result.features[1].geometry).toEqual(polygon.geometry)
  expect(polygon).toEqual(before)
})

it('rejects a batch containing an invalid polygon without modifying any input', async () => {
  const polygon: GisFeature = { id: 'invalid', properties: {}, geometry: { type: 'Polygon', coordinates: [[[116, 39], [117, 40], [117, 39], [116, 40], [116, 39]]] } }
  const input = [line(), polygon], before = structuredClone(input)
  await expect(simplifyFeatures(input, options)).rejects.toThrow('几何简化拒绝')
  expect(input).toEqual(before)
})
