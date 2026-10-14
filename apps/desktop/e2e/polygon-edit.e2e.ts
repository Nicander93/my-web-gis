import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function prepare(page: Page) {
  await page.route('**/*tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'areas.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', features: [116, 117].map((x, index) => ({ type: 'Feature', id: `area-${index}`, properties: { value: index ? 4 : 2, name: `Area ${index}` },
      geometry: { type: 'Polygon', coordinates: [[[x, 39], [x + 1, 39], [x + 1, 40], [x, 40], [x, 39]]] } }))
  })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const panel = page.locator('.attribute-table-tab-panel:not([hidden])')
  for (const row of await panel.locator('tbody input[type=checkbox]').all()) await row.check()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
}

async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    return useProjectStore.getState().getSnapshot()
  })
}

function area(geometry: { type: string; coordinates: number[][][] | number[][][][] }): number {
  const ringArea = (ring: number[][]) => Math.abs(ring.slice(1).reduce((sum, point, index) => sum + ring[index][0] * point[1] - point[0] * ring[index][1], 0) / 2)
  const polygonArea = (rings: number[][][]) => ringArea(rings[0]) - rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0)
  return geometry.type === 'Polygon' ? polygonArea(geometry.coordinates as number[][][]) :
    (geometry.coordinates as number[][][][]).reduce((sum, polygon) => sum + polygonArea(polygon), 0)
}

test('real worker merge/split applies attributes, conserves topology and survives one-step history plus file IO', async ({ page }, info) => {
  await prepare(page)
  const before = await snapshot(page), dataset = before.project.datasets[0].id
  await page.getByRole('button', { name: '合并面', exact: true }).click()
  const merge = page.getByRole('dialog', { name: '合并面', exact: true })
  const policy = merge.getByLabel('合并属性策略')
  await policy.click()
  await page.locator('.ant-select-dropdown').getByText('数值字段求和，其他字段保留指定要素', { exact: true }).click()
  await page.screenshot({ path: info.outputPath('prototype-aligned-merge-dialog.png') })
  await merge.getByRole('button', { name: '计算并应用', exact: true }).click()
  await expect(merge).toHaveCount(0)
  let state = await snapshot(page)
  expect(state.featuresByDataset[dataset]).toHaveLength(1)
  expect(state.featuresByDataset[dataset][0].properties.value).toBe(6)
  expect(area(state.featuresByDataset[dataset][0].geometry)).toBeCloseTo(2, 10)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await snapshot(page)).featuresByDataset).toEqual(before.featuresByDataset)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByRole('button', { name: '分割面', exact: true }).click()
  const split = page.getByRole('dialog', { name: '分割面', exact: true })
  await split.getByLabel('切割线 GeoJSON').fill(JSON.stringify({ type: 'LineString', coordinates: [[117, 38], [117, 41]] }))
  await split.getByRole('button', { name: '计算并应用', exact: true }).click()
  await expect(split).toHaveCount(0)
  state = await snapshot(page)
  const pieces = state.featuresByDataset[dataset]
  expect(pieces).toHaveLength(2)
  expect(new Set(pieces.map((feature) => feature.id)).size).toBe(2)
  expect(pieces.map((feature) => feature.properties.value)).toEqual([6, 6])
  expect(pieces.reduce((sum, feature) => sum + area(feature.geometry), 0)).toBeCloseTo(2, 10)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await snapshot(page)).featuresByDataset[dataset]).toHaveLength(1)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = info.outputPath('topology.webgis.json')
  await (await download).saveAs(path)
  expect(JSON.parse(readFileSync(path, 'utf8')).featuresByDataset[dataset]).toEqual(pieces)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await chooser).setFiles(path)
  expect((await snapshot(page)).featuresByDataset[dataset]).toEqual(pieces)
  await page.locator('.layer-name-button').filter({ hasText: /^areas$/ }).dblclick()
  await page.screenshot({ path: info.outputPath('polygon-topology.png') })
})

test('canceling a real owned worker during load leaves geometry and history untouched', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await prepare(page)
  const before = await snapshot(page)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
  let unblock!: () => void, started!: () => void
  const gate = new Promise<void>((resolve) => { unblock = resolve })
  const requestStarted = new Promise<void>((resolve) => { started = resolve })
  await page.route(/polygon-topology\.worker\.ts/, async (route) => {
    started(); await gate
    await route.continue().catch(() => undefined)
  })
  await page.getByRole('button', { name: '合并面', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '合并面', exact: true })
  await dialog.getByRole('button', { name: '计算并应用', exact: true }).click()
  await requestStarted
  await dialog.getByRole('button', { name: '取消计算', exact: true }).click()
  unblock()
  await expect(dialog.getByText('计算已取消，未修改数据', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: '计算并应用', exact: true })).toBeFocused()
  expect((await snapshot(page)).featuresByDataset).toEqual(before.featuresByDataset)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await snapshot(page)).project.layers).toHaveLength(0)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  expect(errors).toEqual([])
})

test('a completed worker cannot overwrite data edited while computation was pending', async ({ page }) => {
  await prepare(page)
  const before = await snapshot(page), dataset = before.project.datasets[0].id
  let unblock!: () => void, started!: () => void
  const gate = new Promise<void>((resolve) => { unblock = resolve })
  const requestStarted = new Promise<void>((resolve) => { started = resolve })
  await page.route(/polygon-topology\.worker\.ts/, async (route) => {
    started(); await gate
    await route.continue().catch(() => undefined)
  })
  await page.getByRole('button', { name: '合并面', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '合并面', exact: true })
  await dialog.getByRole('button', { name: '计算并应用', exact: true }).click()
  await requestStarted
  // Use the real edit command to model another input arriving during an asynchronous calculation.
  await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const state = useProjectStore.getState(), layer = state.project.layers[0]
    const feature = state.featuresByDataset[layer.datasetId][0]
    state.updateFeatureProperties(layer.id, feature.id, { ...feature.properties, value: 99 })
  })
  const modified = await snapshot(page)
  unblock()
  await expect(dialog.getByRole('alert')).toContainText('计算期间数据或编辑目标已改变，结果未应用')
  const current = await snapshot(page)
  expect(current.featuresByDataset).toEqual(modified.featuresByDataset)
  expect(current.featuresByDataset[dataset]).toHaveLength(2)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await snapshot(page)).featuresByDataset).toEqual(before.featuresByDataset)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await snapshot(page)).project.layers).toHaveLength(0)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
})

test('an invalid or ineffective cutter leaves source features and history unchanged', async ({ page }) => {
  await prepare(page)
  const before = await snapshot(page)
  await page.getByRole('button', { name: '分割面', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '分割面', exact: true })
  await dialog.getByLabel('切割线 GeoJSON').fill('{"type":"Polygon","coordinates":[]}')
  await dialog.getByRole('button', { name: '计算并应用', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('请输入 LineString / MultiLineString GeoJSON')
  await dialog.getByLabel('切割线 GeoJSON').fill('{"type":"LineString","coordinates":[[115,39.5],[116.5,39.5]]}')
  await dialog.getByRole('button', { name: '计算并应用', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('切割线未形成新面')
  expect((await snapshot(page)).featuresByDataset).toEqual(before.featuresByDataset)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await snapshot(page)).project.layers).toHaveLength(0)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
})
