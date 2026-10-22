import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type {} from '../src/cartography-webgl/main'

test('Viewer opts into GPU and retains Canvas for interactive nodes without modifying the scene', async ({ page }) => {
  let interactive = false
  await page.route('**/scene.json', route => route.fulfill({ json: {
    version: 3, id: 'viewer-gpu', title: 'GPU viewer', activeView: 'map',
    views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 4 } },
    resources: { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }] } } },
    nodes: [{ id: 'point', type: 'vector', name: 'Point', resource: 'data', visible: true, interaction: { selectable: interactive }, style: { mode: 'single', symbol: { type: 'circle', radius: 8, fill: { r: 255, g: 0, b: 0, a: 1 } } } }],
    extensions: { 'org.my-web-gis.cartography': { version: 1, required: true, data: { specVersion: 8, bindings: [{ gisLayerId: 'point', datasetId: 'data', styleSourceId: 'data', styleLayerIds: ['point'] }], styleLayers: [{ id: 'point', type: 'circle', source: 'data', paint: { 'circle-color': '#ff0000', 'circle-radius': 8 } }] } } }
  } }))
  await page.goto('http://127.0.0.1:5186')
  const backend = page.getByRole('combobox', { name: '二维渲染后端' })
  await expect(page.getByRole('status')).toContainText('场景已加载')
  await expect(backend).toHaveValue('canvas')
  await backend.selectOption('webgl')
  await expect(page).toHaveURL(/renderer=webgl/)
  await expect(page.getByRole('status')).toContainText('WebGL')
  await expect.poll(() => page.evaluate(() => Array.from(document.querySelectorAll<HTMLCanvasElement>('#map canvas')).some(canvas => !!canvas.getContext('webgl')))).toBe(true)
  interactive = true
  await page.reload()
  await expect(page.getByRole('status')).toContainText('交互或节点过滤继续使用 Canvas')
  await expect(backend).toHaveValue('webgl')
})

test('WebGL draws real features, preserves source counts, falls back and disposes', async ({ page }) => {
  await page.goto('/cartography-webgl.html')
  await page.waitForFunction(() => !!window.cartographyWebGL)
  const results = []
  const directory = resolve('../../docs/design/2d-cartography-p6')
  await mkdir(directory, { recursive: true })
  for (const mode of ['circle', 'line', 'fill', 'road'] as const) {
    for (const renderer of ['canvas', 'webgl'] as const) {
      const result = await page.evaluate(({ renderer, mode }) => window.cartographyWebGL.render(renderer, 1000, mode), { renderer, mode })
      expect(result.actual).toBe(renderer)
      expect(result.coloredPixels).toBeGreaterThan(100)
      expect(result.nativeFeatureCount).toBe(1000)
      results.push(result)
      await page.screenshot({ path: resolve(directory, `webgl-baseline-${mode}-${renderer}.png`), omitBackground: true })
    }
  }
  expect(await page.evaluate(() => window.cartographyWebGL.hide())).toBe(false)
  const label = await page.evaluate(() => window.cartographyWebGL.render('webgl', 30, 'label'))
  expect(label.actual).toBe('canvas')
  expect(label.issues.some(issue => issue.code === 'webgl.fallback')).toBe(true)
  const interactive = await page.evaluate(() => window.cartographyWebGL.render('webgl', 100, 'circle', true))
  expect(interactive.actual).toBe('canvas')
  expect(interactive.issues.some(issue => issue.code === 'webgl.fallback')).toBe(true)
  await page.evaluate(() => window.cartographyWebGL.render('webgl'))
  const lost = await page.evaluate(() => window.cartographyWebGL.loseContext())
  expect(lost.renderer).toBe('canvas')
  expect(lost.count).toBe(1000)
  expect(lost.issues.some(issue => issue.code === 'webgl.context-lost')).toBe(true)
  for (const count of [10000, 50000]) for (const renderer of ['canvas', 'webgl'] as const) results.push(await page.evaluate(({ renderer, count }) => window.cartographyWebGL.render(renderer, count), { renderer, count }))
  expect(await page.evaluate(() => window.cartographyWebGL.dispose())).toBe(0)
  await writeFile(resolve(directory, 'webgl-benchmark.json'), JSON.stringify({ generatedAt: new Date().toISOString(), note: 'Browser measurements, not native GPU acceptance or a universal speed guarantee. Five warm pan frames measure rendercomplete scheduling; initial pixel readback is excluded from warm frames.', results }, null, 2))
})
