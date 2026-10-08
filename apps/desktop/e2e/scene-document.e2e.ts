import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function importScene(page: Page, document: unknown) {
  await page.getByRole('button', { name: '项目', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: 'complete.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) })
}

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
