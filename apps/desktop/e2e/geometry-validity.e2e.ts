import { expect, test } from '@playwright/test'

test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })

test('invalid polygon drawing creates no source ghost or history and a valid drawing still commits once', async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'polygon.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Polygon' }, geometry: { type: 'Polygon', coordinates: [[[116,39],[116.01,39],[116.01,39.01],[116,39.01],[116,39]]] } }] })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '图层面板', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  await page.getByRole('button', { name: '绘制要素', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    return !getMapRuntime()!.getMap().getView().getAnimating()
  })).toBe(true)
  const state = () => page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const store = useProjectStore.getState(), layer = store.project.layers[0]
    return { snapshot: store.getSnapshot(), count: getMapRuntime()!.registry.getVector(layer.id)!.getSource()!.getFeatures().length }
  })
  const before = await state(), bounds = (await page.locator('.ol-viewport').boundingBox())!
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2
  for (const [x,y] of [[-55,-55],[55,55],[-55,55],[55,-55],[-55,-55]]) await page.mouse.click(cx + x, cy + y)
  await expect(page.locator('.status-message')).toContainText('自相交')
  expect(await state()).toEqual(before)
  for (const [x,y] of [[-35,-35],[35,-35],[0,35],[-35,-35]]) await page.mouse.click(cx + x, cy + y)
  await expect.poll(async () => (await state()).count).toBe(before.count + 1)
  const accepted = await state()
  const datasetId = before.snapshot.project.layers[0].datasetId
  expect(accepted.snapshot.featuresByDataset[datasetId]).toHaveLength(before.count + 1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(state).toEqual(before)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(state).toEqual(accepted)
})
