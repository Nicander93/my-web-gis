import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.use({ actionTimeout: 15_000, screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })
async function snapshot(page: Page) {
  return page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().getSnapshot())
}
async function setup(page: Page) {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'routes.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [0, 1].map(index => ({
    type: 'Feature', id: `route-${index}`, properties: { name: `道路 ${index}`, value: index, flag: true, nested: { list: [1, null, false] }, missing: null, source_index: '用户属性' },
    geometry: { type: 'LineString', coordinates: [[116 + index * .01, 39], [116.001 + index * .01, 39.00001], [116.002 + index * .01, 39]] }
  })) })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('tab', { name: '分析', exact: true }).click()
  await page.getByRole('button', { name: '空间处理', exact: true }).click()
  const panel = page.getByRole('region', { name: '空间处理参数' })
  await panel.getByRole('combobox', { name: '处理工具', exact: true }).selectOption('simplify')
  await panel.getByRole('spinbutton', { name: '简化容差（度）', exact: true }).fill('0.0001')
  await panel.getByLabel('结果图层名称', { exact: true }).fill('简化道路')
  return panel
}

test('real GeoLibre worker preserves typed data, creates one undoable layer and round trips a saved project', async ({ page }, info) => {
  test.setTimeout(150_000)
  const remote: string[] = [], wasm: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (/\.wasm(?:\?|$)/.test(url.pathname)) wasm.push(request.url())
    if (url.hostname !== '127.0.0.1' && !url.hostname.endsWith('tile.openstreetmap.org') && url.protocol.startsWith('http')) remote.push(request.url())
  })
  const panel = await setup(page)
  const before = await snapshot(page), source = before.project.layers[0]
  const inputs = before.featuresByDataset[source.datasetId]
  await panel.getByRole('button', { name: '生成结果图层', exact: true }).click()
  await expect(page.locator('.layer-name-button').filter({ hasText: '简化道路' })).toBeVisible({ timeout: 60_000 })
  const after = await snapshot(page)
  expect(after.project.layers).toHaveLength(2)
  expect(after.featuresByDataset[source.datasetId]).toEqual(inputs)
  const result = after.project.layers.find(layer => layer.name === '简化道路')!
  const rows = after.featuresByDataset[result.datasetId]
  expect(rows).toHaveLength(inputs.length)
  await expect.poll(async () => page.evaluate(async id => {
    const runtime = (await import('/src/features/map/map-runtime-host.ts')).getMapRuntime()
    const layer = runtime?.registry.getVector(id)
    return { visible: layer?.getVisible(), geometries: layer?.getSource()?.getFeatures().map(feature => feature.getGeometry()?.getType()) }
  }, result.id)).toEqual({ visible: true, geometries: ['LineString', 'LineString'] })
  rows.forEach((row, index) => {
    expect(row.properties).toEqual(inputs[index].properties)
    expect(row.id).not.toBe(inputs[index].id)
    expect(row.metadata?.sourceId).toBe(inputs[index].id)
    expect(row.geometry.type).toBe('LineString')
    expect(row.geometry.coordinates).toEqual([inputs[index].geometry.coordinates[0], inputs[index].geometry.coordinates[2]])
  })
  expect(after.project.datasets.find(dataset => dataset.id === result.datasetId)).toMatchObject({ processing: {
    engine: { id: 'geolibre-wasm', version: '1.7.1', tool: 'simplify_features' }, options: { tool: 'simplify', tolerance: .0001, unit: 'degrees' }
  } })
  expect(wasm.some(url => url.includes('geolibre-cli'))).toBe(true)
  expect(remote).toEqual([])
  await panel.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(await snapshot(page)).toEqual(after)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const file = info.outputPath('simplified.webgis.json')
  await (await downloading).saveAs(file)
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  expect(saved.featuresByDataset).toEqual(after.featuresByDataset)
  expect(saved.project.datasets).toEqual(after.project.datasets)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const choosing = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await choosing).setFiles(file)
  expect(await snapshot(page)).toEqual(saved)
})

for (const action of ['cancel', 'replace'] as const) test(`${action} during real WASM loading cannot add a late result`, async ({ page }) => {
  test.setTimeout(120_000)
  const panel = await setup(page)
  const before = await snapshot(page)
  let release!: () => void, requested = false
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/*geolibre-cli*.wasm*', async route => {
    requested = true
    await gate
    await route.continue().catch(() => {})
  })
  try {
    await panel.getByRole('button', { name: '生成结果图层', exact: true }).click()
    await expect.poll(() => requested, { timeout: 30_000 }).toBe(true)
    if (action === 'cancel') await panel.getByRole('button', { name: '取消处理', exact: true }).click()
    else await page.evaluate(async () => {
      const store = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
      store.loadSnapshot(store.getSnapshot())
    })
    release()
    if (action === 'cancel') await expect(panel.getByRole('button', { name: '生成结果图层', exact: true })).toBeEnabled()
    else await expect(panel).toBeHidden()
    await expect.poll(async () => page.evaluate(async () => (await import('/src/stores/task-log.store.ts')).useTaskLogStore.getState().entries.some(task => task.title === '空间处理' && task.status === 'cancelled'))).toBe(true)
    expect(await snapshot(page)).toEqual(before)
  } finally { release() }
})
