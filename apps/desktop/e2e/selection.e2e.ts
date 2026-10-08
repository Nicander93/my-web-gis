import { test, expect, type Page } from '@playwright/test'

async function mapState(page: Page) {
  return page.evaluate(async () => {
    // Observe the live runtime; selection is changed only by actual mouse/keyboard input.
    const host = await import('/src/features/map/map-runtime-host.ts')
    const store = await import('/src/stores/project.store.ts')
    const state = store.useProjectStore.getState()
    const runtime = host.getMapRuntime()!
    const map = runtime.getMap()
    const layer = runtime.registry.getVector(state.selectedLayerId!)!
    const positions = layer.getSource()!.getFeatures().map(feature => ({
      id: String(feature.getId()), pixel: map.getPixelFromCoordinate(feature.getGeometry()!.getExtent().slice(0, 2))
    })).sort((a, b) => a.pixel[0] - b.pixel[0])
    return { positions, selection: state.selection.featureIds, center: map.getView().getCenter(), dirty: state.dirty }
  })
}

async function drag(page: Page, from: number[], to: number[], key?: 'Shift' | 'Alt') {
  const bounds = (await page.locator('.ol-viewport').boundingBox())!
  if (key) await page.keyboard.down(key)
  await page.mouse.move(bounds.x + from[0], bounds.y + from[1])
  await page.mouse.down()
  await page.mouse.move(bounds.x + to[0], bounds.y + to[1], { steps: 12 })
  await page.mouse.up()
  if (key) await page.keyboard.up(key)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'selection.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', features: [0, 1, 2].map(index => ({ type: 'Feature', id: `point-${index}`,
      properties: { name: `Point ${index}` }, geometry: { type: 'Point', coordinates: [116.4 + index * .02, 39.9] } }))
  })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await page.waitForTimeout(350)
})

test('box selection links the accepted rows; modifiers, empty selection and row locate work', async ({ page }, info) => {
  let state = await mapState(page)
  const first = state.positions[0].pixel
  await drag(page, [first[0] - 12, first[1] - 12], [first[0] + 12, first[1] + 12])
  await expect(page.getByRole('complementary', { name: '属性表面板' })).toBeVisible()
  await expect(page.getByLabel('仅选中', { exact: true })).toBeChecked()
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await expect.poll(async () => (await mapState(page)).selection).toEqual([state.positions[0].id])
  const before = (await mapState(page)).center
  const row = page.locator('.table-scroll tbody tr').first()
  await row.locator('td').nth(2).dblclick()
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await page.waitForTimeout(250)
  expect((await mapState(page)).center).not.toEqual(before)
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await page.waitForTimeout(350)
  state = await mapState(page)
  const second = state.positions[1].pixel
  await drag(page, [second[0] - 12, second[1] - 12], [second[0] + 12, second[1] + 12], 'Shift')
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(2)
  await drag(page, [second[0] - 12, second[1] - 12], [second[0] + 12, second[1] + 12], 'Alt')
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await drag(page, [20, 20], [40, 40])
  await expect(page.getByLabel('表格状态与分页')).toContainText('选中 0')
  await expect(page.getByLabel('表格状态与分页')).toContainText('0 / 0')
  await page.screenshot({ path: info.outputPath('selection-empty.png') })
})

test('escape cancels a live drag and preserves selection and camera', async ({ page }) => {
  const initial = await mapState(page)
  const first = initial.positions[0].pixel
  await drag(page, [first[0] - 12, first[1] - 12], [first[0] + 12, first[1] + 12])
  const before = await mapState(page)
  const bounds = (await page.locator('.ol-viewport').boundingBox())!
  await page.mouse.move(bounds.x + 20, bounds.y + 20)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 200, bounds.y + 150, { steps: 8 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  const after = await mapState(page)
  expect(after.selection).toEqual(before.selection)
  expect(after.center).toEqual(before.center)
})

test('standalone package lifecycle retains highlights and releases only owned resources', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const consumer = await import('/e2e/selection-consumer.ts')
    return consumer.exerciseLifecycle()
  })
  expect(result).toEqual({ retained: 1, ownedInteraction: true, silent: true, interactionsRestored: true,
    overlayReleased: true, sourceIntact: true, mapIntact: true })
})

test('a deliberate click after a box is accepted and keeps selection on pan', async ({ page }) => {
  const initial = await mapState(page)
  const first = initial.positions[0].pixel
  await drag(page, [first[0] - 12, first[1] - 12], [first[0] + 12, first[1] + 12])
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  const state = await mapState(page)
  const bounds = (await page.locator('.ol-viewport').boundingBox())!
  const point = state.positions[1]
  await page.mouse.click(bounds.x + point.pixel[0], bounds.y + point.pixel[1])
  await expect.poll(async () => (await mapState(page)).selection).toEqual([point.id])
  await page.getByRole('button', { name: '平移', exact: true }).click()
  await drag(page, [100, 100], [150, 100])
  const after = await mapState(page)
  expect(after.selection).toEqual([point.id])
  expect(after.center).not.toEqual(state.center)
})
