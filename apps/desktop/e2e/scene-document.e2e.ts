import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function importScene(page: Page, document: unknown) {
  await page.getByRole('button', { name: '项目', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: 'complete.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) })
}

function remoteScene() {
  return { version: 3, id: 'remote', title: 'Remote scene', activeView: 'map',
    views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 3 } },
    resources: { points: { type: 'geojson', url: 'https://scene-fixture.test/points.geojson' } },
    nodes: [{ type: 'vector', id: 'points', name: 'Remote points', resource: 'points', visible: true, style: { mode: 'single', symbol: { type: 'circle', radius: 4 } } }]
  }
}

async function startMap(page: Page) {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.locator('[data-map-runtime="mounted"]')).toBeVisible()
}

test('remote scene resource preparation completes before import and exports inline data', async ({ page }, testInfo) => {
  const data = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'remote-1', geometry: { type: 'Point', coordinates: [1, 0] }, properties: { name: 'Remote feature' } }] }
  await page.route('https://scene-fixture.test/points.geojson', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) }))
  await startMap(page)
  await importScene(page, remoteScene())
  await expect(page.locator('.layer-name-button')).toContainText('Remote points')
  await page.getByRole('button', { name: '项目', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出完整场景', exact: true }).click()
  const path = testInfo.outputPath('prepared.scene.json')
  await (await download).saveAs(path)
  const exported = JSON.parse(readFileSync(path, 'utf8'))
  expect(exported.resources.points.data).toEqual(data)
  expect(exported.resources.points.url).toBeUndefined()
})

test('failed remote scene import leaves the original empty project untouched', async ({ page }) => {
  await page.route('https://scene-fixture.test/points.geojson', route => route.fulfill({ status: 503, body: 'Unavailable' }))
  await startMap(page)
  await importScene(page, remoteScene())
  await expect(page.getByText('导入失败：矢量资源请求失败：HTTP 503', { exact: true })).toBeVisible()
  await expect(page.locator('.layer-name-button')).toHaveCount(0)
  await expect(page.locator('[data-map-runtime="mounted"]')).toBeVisible()
})

test('cancel menu prevents a delayed resource from replacing the project', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('https://scene-fixture.test/points.geojson', async route => {
    await gate
    await route.abort().catch(() => {})
  })
  await startMap(page)
  const request = page.waitForRequest('https://scene-fixture.test/points.geojson')
  await importScene(page, remoteScene())
  await request
  await page.getByRole('button', { name: '项目', exact: true }).click()
  await page.getByRole('menuitem', { name: '取消场景导入', exact: true }).click()
  release()
  await expect(page.getByText('已取消场景导入，原项目保持不变', { exact: true })).toBeVisible()
  await expect(page.locator('.layer-name-button')).toHaveCount(0)
})

test('full scene menu preserves filtered-out data and imports through shared undo history', async ({ page }, testInfo) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.locator('[data-map-runtime="mounted"]')).toBeVisible()
  const document = {
    version: 3, id: 'complete', title: 'Complete scene', activeView: 'map',
    views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 3 } },
    resources: { points: { type: 'geojson', data: { type: 'FeatureCollection', features: [1, 2, 3].map(value => ({ type: 'Feature', id: String(value), geometry: { type: 'Point', coordinates: [value, 0] }, properties: { value } })) } } },
    nodes: [{ type: 'vector', id: 'points', name: 'All points', resource: 'points', visible: true, style: { mode: 'single', symbol: { type: 'circle', radius: 4 } }, filter: [{ field: 'value', op: 'eq', value: 1 }] }]
  }
  await importScene(page, document)
  await expect(page.locator('.layer-name-button')).toContainText('All points')
  await page.locator('.layer-name-button').click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await expect(page.getByRole('complementary', { name: '属性表面板' })).toContainText('过滤后 1')
  await page.getByRole('button', { name: '项目', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出完整场景', exact: true }).click()
  const downloaded = await download, path = testInfo.outputPath('complete.scene.json')
  await downloaded.saveAs(path)
  const exported = JSON.parse(readFileSync(path, 'utf8'))
  expect(exported.version).toBe(3)
  expect(exported.resources.points.data.features).toHaveLength(3)
  expect(exported.nodes.find((node: { id: string }) => node.id === 'points').filter).toEqual(document.nodes[0].filter)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toHaveCount(0)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toContainText('All points')
  await page.screenshot({ path: testInfo.outputPath('scene-roundtrip.png') })
})
