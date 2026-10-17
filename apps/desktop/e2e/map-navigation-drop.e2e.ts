import { expect, test, type Page } from '@playwright/test'

test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false }, actionTimeout: 15_000 })
const data = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: '拖入道路', value: 42 }, geometry: { type: 'LineString', coordinates: [[116, 39], [116.01, 39.01]] } }] })
async function setup(page: Page) {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.getByTestId('map-runtime-viewport')).toBeVisible()
}
async function drop(page: Page, target: string, names = ['roads.geojson']) {
  const files = await page.evaluateHandle(({ data, names }) => {
    const transfer = new DataTransfer()
    names.forEach(name => transfer.items.add(new File([data], name, { type: 'application/json' })))
    return transfer
  }, { data, names })
  await page.locator(target).dispatchEvent('dragover', { dataTransfer: files })
  await page.locator(target).dispatchEvent('drop', { dataTransfer: files })
  await files.dispose()
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const host = await import('/src/features/map/map-runtime-host.ts')
    const store = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    return { center: host.getMapRuntime()!.getMap().getView().getCenter(), snapshot: store.getSnapshot(), selection: store.selection, tool: host.getActiveEditTool() }
  })
}
async function drag(page: Page, button: 'middle' | 'left', space = false) {
  const box = (await page.getByTestId('map-runtime-viewport').boundingBox())!
  // Selection can open the bottom dock; keep navigation above its overlay.
  const x = box.x + box.width * .6, y = box.y + box.height * .3
  await page.mouse.move(x, y)
  if (space) await page.keyboard.down('Space')
  await page.mouse.down({ button })
  await page.mouse.move(x + 75, y + 35, { steps: 8 })
  await page.mouse.up({ button })
  if (space) await page.keyboard.up('Space')
}

for (const [name, target] of [['地图', '[data-testid=map-runtime-viewport]'], ['图层面板', '[aria-label="图层面板"]']] as const) test(`drop on ${name} previews, commits once, and undoes`, async ({ page }) => {
  await setup(page)
  const before = await state(page)
  await drop(page, target)
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeVisible()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.locator('.layer-name-button').filter({ hasText: 'roads' })).toBeVisible()
  expect((await state(page)).snapshot.project.layers).toHaveLength(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
})

test('rejects multiple and unsupported files; cancellation leaves the project unchanged', async ({ page }) => {
  await setup(page)
  const before = await state(page)
  await drop(page, '[data-testid=map-runtime-viewport]', ['a.geojson', 'b.geojson'])
  await expect(page.getByText('一次请拖入一个文件；SHP 请使用 ZIP。', { exact: true })).toBeVisible()
  await drop(page, '[data-testid=map-runtime-viewport]', ['a.exe'])
  await expect(page.getByText('支持拖入 GeoJSON、SHP ZIP、DXF 或 CSV 文件。', { exact: true })).toBeVisible()
  await drop(page, '[data-testid=map-runtime-viewport]')
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭添加数据', exact: true }).click()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
})

test('file drop on an existing layer row adds data without reordering the layer', async ({ page }) => {
  await setup(page)
  await drop(page, '[data-testid=map-runtime-viewport]')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  const before = await state(page)
  await drop(page, '.layer-name-button')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  expect((await state(page)).snapshot.project.layers).toHaveLength(2)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
})

test('middle and space-left pan preserve selection and an unfinished drawing', async ({ page }) => {
  await setup(page)
  await drop(page, '[data-testid=map-runtime-viewport]')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.evaluate(async () => {
    const store = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    const layer = store.project.layers[0]
    store.setSelection({ layerId: layer.id, featureIds: store.getLayerFeatures(layer.id).map(row => row.id) })
  })
  const before = await state(page)
  await drag(page, 'middle')
  const middle = await state(page)
  expect(middle.center).not.toEqual(before.center)
  expect(middle.selection).toEqual(before.selection)
  expect(middle.snapshot).toEqual(before.snapshot)
  expect(middle.tool).toBe('select')
  await drag(page, 'left', true)
  const spaced = await state(page)
  expect(spaced.center).not.toEqual(middle.center)
  expect(spaced.selection).toEqual(before.selection)
  expect(spaced.snapshot).toEqual(before.snapshot)
  await page.evaluate(async () => { (await import('/src/features/map/map-runtime-host.ts')).setActiveEditTool('draw-line') })
  const box = (await page.getByTestId('map-runtime-viewport').boundingBox())!
  await page.mouse.click(box.x + box.width * .48, box.y + box.height * .5)
  await drag(page, 'middle')
  await drag(page, 'left', true)
  expect((await state(page)).tool).toBe('draw-line')
  expect((await state(page)).snapshot).toEqual(before.snapshot)
  await page.mouse.dblclick(box.x + box.width * .65, box.y + box.height * .65)
  await expect.poll(async () => {
    const current = await state(page), layer = current.snapshot.project.layers[0]
    return current.snapshot.featuresByDataset[layer.datasetId].length
  }).toBe(2)
  const current = await state(page), layer = current.snapshot.project.layers[0]
  expect(current.snapshot.featuresByDataset[layer.datasetId][1].geometry.coordinates).toHaveLength(2)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
})

test('compact ribbon leaves map space and keeps commands reachable', async ({ page }) => {
  await setup(page)
  const ribbon = page.getByRole('region', { name: '二维功能区' })
  expect((await ribbon.boundingBox())!.height).toBeLessThanOrEqual(70)
  for (const name of ['数据', '编辑', '分析']) {
    await page.getByRole('tab', { name, exact: true }).click()
    await expect(page.getByTestId('map-runtime-viewport')).toBeVisible()
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

test('space in inputs is text; blur releases temporary pan and left drag selects again', async ({ page }) => {
  await setup(page)
  await drop(page, '[data-testid=map-runtime-viewport]')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('button', { name: '搜索图层', exact: true }).click()
  const search = page.getByRole('textbox', { name: /搜索图层/ })
  await search.fill('a')
  await search.press('Space')
  await expect(search).toHaveValue('a ')
  await search.fill('')
  await page.getByTestId('map-runtime-viewport').click({ position: { x: 450, y: 200 } })
  const before = await state(page)
  await page.keyboard.down('Space')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.keyboard.up('Space')
  await drag(page, 'left')
  expect((await state(page)).center).toEqual(before.center)
  expect((await state(page)).tool).toBe('select')
  await drag(page, 'left', true)
  expect((await state(page)).center).not.toEqual(before.center)
})
