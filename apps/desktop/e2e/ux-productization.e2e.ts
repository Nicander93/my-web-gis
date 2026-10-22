import { expect, test, type Page } from '@playwright/test'

test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })
test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.getByRole('region', { name: '地图工作区' })).toHaveAttribute('data-map-runtime', 'mounted')
})

async function seed(page: Page) {
  return page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    useProjectStore.getState().addLayer('ux-points', '站点', [
      { id: 'station-a', type: 'Feature', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { 名称: '甲站', 流量: 24 } },
      { id: 'station-b', type: 'Feature', geometry: { type: 'Point', coordinates: [116.01, 39] }, properties: { 名称: '乙站', 流量: 32 } }
    ], 'point')
    return useProjectStore.getState().project.layers.at(-1)!.id
  })
}

test('information rail preserves tools and selection; identify opens retained real results', async ({ page }) => {
  const id = await seed(page)
  await page.evaluate(async id => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    useProjectStore.getState().setSelection({ layerId: id, featureIds: ['station-b'] })
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const runtime = getMapRuntime()!
    const feature = runtime.registry.getVector(id)!.getSource()!.getFeatureById('station-a')!
    const map = runtime.getMap()
    map.getView().setCenter(feature.getGeometry()!.getCoordinates())
    map.getView().setZoom(15)
    map.renderSync()
  }, id)
  const rail = page.getByRole('navigation', { name: '右侧工作面板' })
  await page.getByRole('button', { name: '平移', exact: true }).click()
  const tool = await page.evaluate(async () => (await import('/src/features/map/map-runtime-host.ts')).getActiveEditTool())
  await rail.getByRole('button', { name: '信息', exact: true }).click()
  await expect(page.getByText('暂无识别结果', { exact: true })).toBeVisible()
  expect(await page.evaluate(async () => (await import('/src/features/map/map-runtime-host.ts')).getActiveEditTool())).toBe(tool)
  await rail.getByRole('button', { name: '信息', exact: true }).click()
  await page.getByRole('button', { name: '识别', exact: true }).click()
  const pixel = await page.evaluate(async id => {
    const runtime = (await import('/src/features/map/map-runtime-host.ts')).getMapRuntime()!
    const geometry = runtime.registry.getVector(id)!.getSource()!.getFeatureById('station-a')!.getGeometry()!
    return runtime.getMap().getPixelFromCoordinate(geometry.getCoordinates())
  }, id)
  const viewport = await page.getByTestId('map-runtime-viewport').boundingBox()
  await page.mouse.click(viewport!.x + pixel[0], viewport!.y + pixel[1])
  await expect(page.locator('.information-panel')).toContainText('甲站')
  const selection = await page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().selection)
  expect(selection).toEqual({ layerId: id, featureIds: ['station-b'] })
  await page.getByRole('button', { name: '平移', exact: true }).click()
  await rail.getByRole('button', { name: '属性', exact: true }).click()
  await expect(page.getByRole('tab', { name: '要素', exact: true })).toHaveCount(0)
  await rail.getByRole('button', { name: '信息', exact: true }).click()
  await expect(page.locator('.information-panel')).toContainText('甲站')
  expect(await page.evaluate(async () => (await import('/src/features/map/map-runtime-host.ts')).getActiveEditTool())).toBe('pan')
})

test('software appearance persists independently of project cartography and keeps controls reachable', async ({ page }) => {
  await seed(page)
  const before = await page.evaluate(async () => {
    const state = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    return { cartography: state.project.cartography, dirty: state.dirty, undo: state.canUndoEdit() }
  })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '软件设置', exact: true })
  await settings.getByLabel('界面字号', { exact: true }).click()
  await page.getByRole('option', { name: '14 px', exact: true }).click()
  await settings.getByLabel('控件密度', { exact: true }).click()
  await page.getByRole('option', { name: '标准', exact: true }).click()
  await settings.getByLabel('软件主题', { exact: true }).click()
  await page.getByRole('option', { name: '深色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size-ui').trim())).toBe('14px')
  const after = await page.evaluate(async () => {
    const state = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    return { cartography: state.project.cartography, dirty: state.dirty, undo: state.canUndoEdit() }
  })
  expect(after).toEqual(before)
  const rect = await settings.boundingBox(), viewport = page.viewportSize()!
  expect(rect!.x).toBeGreaterThanOrEqual(0)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height)
  await settings.getByRole('button', { name: '关闭软件设置', exact: true }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'standard')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size-ui').trim())).toBe('14px')
})
