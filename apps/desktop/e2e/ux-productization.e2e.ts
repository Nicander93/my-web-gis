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
    const { layerContentCommands } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/commands/layer-content.commands.ts').at(-1) ?? '/src/commands/layer-content.commands.ts')

    const { useProjectStore } = await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/project/project.store.ts') ?? '/src/project/project.store.ts')
    layerContentCommands.addLayer('ux-points', '站点', [
      { id: 'station-a', type: 'Feature', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { 名称: '甲站', 流量: 24 } },
      { id: 'station-b', type: 'Feature', geometry: { type: 'Point', coordinates: [116.01, 39] }, properties: { 名称: '乙站', 流量: 32 } }
    ], 'point')
    return useProjectStore.getState().project.content.layers.at(-1)!.id
  })
}

test('information rail preserves tools and selection; identify opens retained real results', async ({ page }) => {
  const id = await seed(page)
  await page.evaluate(async () => (await import('/src/stores/preferences.store.ts')).usePreferencesStore.getState().update({ fontSize: 8 }))
  await page.evaluate(async id => {
    const { useProjectStore } = await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/project/project.store.ts') ?? '/src/project/project.store.ts')
    const { selectionCommands } = await import('/src/commands/selection.commands.ts')
    selectionCommands.setSelection({ layerId: id, featureIds: ['station-b'] })
    const { getMapRuntime } = await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/engine-host/map-runtime-host.ts') ?? '/src/engine-host/map-runtime-host.ts')
    const runtime = getMapRuntime()!
    const feature = runtime.registry.getVector(id)!.getSource()!.getFeatureById('station-a')!
    const map = runtime.getMap()
    map.getView().setCenter(feature.getGeometry()!.getCoordinates())
    map.getView().setZoom(15)
    map.renderSync()
  }, id)
  const rail = page.getByRole('navigation', { name: '右侧工作面板' })
  await page.getByRole('button', { name: '平移', exact: true }).click()
  const tool = await page.evaluate(async () => (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/engine-host/map-runtime-host.ts') ?? '/src/engine-host/map-runtime-host.ts')).getActiveEditTool())
  await rail.getByRole('button', { name: '信息', exact: true }).click()
  await expect(page.getByText('暂无识别结果', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: '属性', exact: true })).toHaveAttribute('aria-checked', 'false')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(async () => (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/engine-host/map-runtime-host.ts') ?? '/src/engine-host/map-runtime-host.ts')).getActiveEditTool())).toBe(tool)
  await rail.getByRole('button', { name: '信息', exact: true }).click()
  await page.getByRole('button', { name: '识别', exact: true }).click()
  const pixel = await page.evaluate(async id => {
    const runtime = (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/engine-host/map-runtime-host.ts') ?? '/src/engine-host/map-runtime-host.ts')).getMapRuntime()!
    const geometry = runtime.registry.getVector(id)!.getSource()!.getFeatureById('station-a')!.getGeometry()!
    return runtime.getMap().getPixelFromCoordinate(geometry.getCoordinates())
  }, id)
  const viewport = await page.getByTestId('map-runtime-viewport').boundingBox()
  await page.mouse.click(viewport!.x + pixel[0], viewport!.y + pixel[1])
  await expect(page.locator('.information-panel')).toContainText('甲站')
  const selection = await page.evaluate(async () => { const selectionSession = (await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/stores/layer-view.store.ts').at(-1) ?? '/src/stores/layer-view.store.ts')).useLayerViewStore.getState(); return selectionSession.selection })
  expect(selection).toEqual({ layerId: id, featureIds: ['station-b'] })
  await page.getByRole('button', { name: '平移', exact: true }).click()
  await rail.getByRole('button', { name: '属性', exact: true }).click()
  await expect(page.getByRole('tab', { name: '要素', exact: true })).toHaveCount(0)
  await rail.getByRole('button', { name: '信息', exact: true }).click()
  await expect(page.locator('.information-panel')).toContainText('甲站')
  expect(await page.evaluate(async () => (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/engine-host/map-runtime-host.ts') ?? '/src/engine-host/map-runtime-host.ts')).getActiveEditTool())).toBe('pan')
})

test('software appearance persists independently of project cartography and keeps controls reachable', async ({ page }) => {
  await seed(page)
  const before = await page.evaluate(async () => {
    const { projectEdits } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-edits.ts').at(-1) ?? '/src/project/project-edits.ts')

    const state = (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/project/project.store.ts') ?? '/src/project/project.store.ts')).useProjectStore.getState()
    return { cartography: state.project.content.cartography, dirty: state.dirty, undo: projectEdits.canUndo() }
  })
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '软件设置', exact: true })
  const fontSize = settings.getByRole('slider', { name: '界面字号' })
  await fontSize.focus()
  await fontSize.press('Home')
  await expect(fontSize).toHaveAttribute('aria-valuenow', '8')
  await expect(settings.getByText('8 px · 67%', { exact: true })).toBeVisible()
  const compactDialog = (await settings.boundingBox())!
  const compact = await page.evaluate(() => ({
    header: document.querySelector('.window-bar')!.getBoundingClientRect().height,
    rail: document.querySelector('.workspace-toolrail')!.getBoundingClientRect().width,
    layer: document.querySelector('.panel-left')!.getBoundingClientRect().width,
    icon: document.querySelector('.workspace-toolrail svg')!.getBoundingClientRect().width
  }))
  const resize = page.getByRole('separator', { name: '调整图层窗口大小' })
  const resizeBounds = (await resize.boundingBox())!
  await page.mouse.move(resizeBounds.x + resizeBounds.width / 2, resizeBounds.y + resizeBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizeBounds.x + resizeBounds.width / 2 + 20, resizeBounds.y + resizeBounds.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect.poll(async () => (await page.locator('.panel-left').boundingBox())!.width).toBeGreaterThan(compact.layer + 10)
  const sliderBounds = (await settings.locator('.ant-slider').boundingBox())!
  const handleBounds = (await fontSize.boundingBox())!
  await page.mouse.move(handleBounds.x + handleBounds.width / 2, handleBounds.y + handleBounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(sliderBounds.x + sliderBounds.width - 1, handleBounds.y + handleBounds.height / 2, { steps: 10 })
  await page.mouse.up()
  await expect(fontSize).toHaveAttribute('aria-valuenow', '14')
  await expect(settings.getByText('14 px · 117%', { exact: true })).toBeVisible()
  const largeDialog = (await settings.boundingBox())!
  const large = await page.evaluate(() => ({
    header: document.querySelector('.window-bar')!.getBoundingClientRect().height,
    rail: document.querySelector('.workspace-toolrail')!.getBoundingClientRect().width,
    layer: document.querySelector('.panel-left')!.getBoundingClientRect().width,
    icon: document.querySelector('.workspace-toolrail svg')!.getBoundingClientRect().width
  }))
  expect(compact.header).toBeLessThan(large.header)
  expect(compact.rail).toBeLessThan(large.rail)
  expect(compact.layer).toBeLessThan(large.layer)
  expect(compact.icon).toBeLessThan(large.icon)
  expect(compactDialog.width).toBeLessThan(largeDialog.width)
  await settings.getByLabel('控件密度', { exact: true }).click()
  await page.getByRole('option', { name: '标准', exact: true }).click()
  await settings.getByLabel('软件主题', { exact: true }).click()
  await page.getByRole('option', { name: '深色', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size-ui').trim())).toBe('14px')
  const after = await page.evaluate(async () => {
    const { projectEdits } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-edits.ts').at(-1) ?? '/src/project/project-edits.ts')

    const state = (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/project/project.store.ts') ?? '/src/project/project.store.ts')).useProjectStore.getState()
    return { cartography: state.project.content.cartography, dirty: state.dirty, undo: projectEdits.canUndo() }
  })
  expect(after).toEqual(before)
  const rect = await settings.boundingBox(), viewport = page.viewportSize()!
  expect(rect!.x).toBeGreaterThanOrEqual(0)
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport.width)
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport.height)
  await fontSize.focus()
  await fontSize.press('Home')
  await expect(fontSize).toHaveAttribute('aria-valuenow', '8')
  await settings.getByRole('button', { name: '关闭软件设置', exact: true }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'standard')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-size-ui').trim())).toBe('8px')
})

test('empty attribute table keeps the layer picker without an empty toolbar', async ({ page }) => {
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '属性表', exact: true }).click()
  const table = page.getByRole('complementary', { name: '属性表面板' })
  await expect(table.getByLabel('属性表图层', { exact: true })).toBeVisible()
  await expect(table.getByLabel('属性表工具', { exact: true })).toHaveCount(0)
  await expect(table).toContainText('请选择一个图层')
  await seed(page)
  await table.getByLabel('属性表图层', { exact: true }).click()
  await page.getByRole('option', { name: '站点', exact: true }).click()
  await expect(table.getByLabel('属性表工具', { exact: true })).toBeVisible()
})

test('layer legends are view state and map filtering remains separate from table search', async ({ page }) => {
  const id = await seed(page)
  const before = await page.evaluate(async () => { const { projectSession } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-session.ts').at(-1) ?? '/src/project/project-session.ts'); return projectSession.getSnapshot() })
  await page.getByRole('button', { name: '展开站点图例', exact: true }).click()
  await expect(page.getByLabel('站点图例', { exact: true })).toBeVisible()
  expect(await page.evaluate(async () => { const { projectSession } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-session.ts').at(-1) ?? '/src/project/project-session.ts'); return projectSession.getSnapshot() })).toEqual(before)
  await page.evaluate(async id => (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/commands/layer.commands.ts') ?? '/src/commands/layer.commands.ts')).layerCommands.openFilter(id), id)
  const filter = page.getByRole('dialog', { name: '图层过滤', exact: true })
  await filter.getByLabel('图层过滤字段', { exact: true }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText('流量', { exact: true }).click()
  await filter.getByLabel('图层过滤值', { exact: true }).fill('32')
  await filter.getByRole('button', { name: '添加', exact: true }).click()
  await filter.getByRole('button', { name: '应用图层过滤', exact: true }).click()
  const inclusion = () => page.evaluate(async id => {
    const state = (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/project/project.store.ts') ?? '/src/project/project.store.ts')).useProjectStore.getState()
    const runtime = (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/engine-host/map-runtime-host.ts') ?? '/src/engine-host/map-runtime-host.ts')).getMapRuntime()!
    const source = runtime.registry.getVector(id)!.getSource()!
    return { filter: state.project.content.layers.find(layer => layer.id === id)!.filter,
      first: runtime.isFeatureIncluded(id, source.getFeatureById('station-a')!), second: runtime.isFeatureIncluded(id, source.getFeatureById('station-b')!) }
  }, id)
  await expect.poll(inclusion).toEqual({ filter: [{ field: '流量', op: 'eq', value: 32 }], first: false, second: true })
  await page.evaluate(async id => (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/commands/layer.commands.ts') ?? '/src/commands/layer.commands.ts')).layerCommands.openAttributeTable(id), id)
  const attributes = page.getByRole('complementary', { name: '属性表面板' })
  await attributes.getByLabel('表内搜索', { exact: true }).fill('甲站')
  await expect(attributes.locator('tbody tr')).toHaveCount(1)
  expect(await inclusion()).toEqual({ filter: [{ field: '流量', op: 'eq', value: 32 }], first: false, second: true })
  const mapBefore = await page.getByTestId('map-runtime-viewport').boundingBox()
  await page.getByRole('button', { name: '图层属性', exact: true }).click()
  const left = await page.getByRole('complementary', { name: '图层面板', exact: true }).boundingBox()
  const right = await page.getByRole('complementary', { name: '检查器面板', exact: true }).boundingBox()
  const table = await attributes.boundingBox()
  expect(table!.x).toBeCloseTo(left!.x, 0)
  expect(left!.y + left!.height).toBeLessThanOrEqual(table!.y + 1)
  expect(right!.y + right!.height).toBeLessThanOrEqual(table!.y + 1)
  await attributes.getByLabel('表内搜索', { exact: true }).click()
  expect(await page.getByTestId('map-runtime-viewport').boundingBox()).toEqual(mapBefore)
  await attributes.getByRole('button', { name: '最大化属性表', exact: true }).click()
  const close = await attributes.getByRole('button', { name: '关闭属性表窗口', exact: true }).boundingBox()
  const rail = await page.getByRole('navigation', { name: '右侧工作面板' }).boundingBox()
  expect(close!.x + close!.width).toBeLessThanOrEqual(rail!.x)
  await attributes.getByRole('button', { name: '还原属性表', exact: true }).click()
})

test('layer context menus open the existing SLD and GeoServer workflows without changing data', async ({ page }) => {
  await seed(page)
  const before = await page.evaluate(async () => { const { projectSession } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-session.ts').at(-1) ?? '/src/project/project-session.ts'); return projectSession.getSnapshot() })
  await page.getByRole('button', { name: '更多操作 站点', exact: true }).click()
  await page.getByRole('menuitem', { name: '导出 SLD…', exact: true }).click()
  const sld = page.getByRole('dialog', { name: '导出 SLD', exact: true })
  await expect(sld).toBeVisible()
  await sld.locator('.ant-modal-footer').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '更多操作 站点', exact: true }).click()
  await page.getByRole('menuitem', { name: '发布到 GeoServer…', exact: true }).click()
  const publish = page.getByRole('dialog', { name: '发布“站点”到 GeoServer', exact: true })
  await expect(publish.getByText('GeoServer 根地址', { exact: true })).toBeVisible()
  await publish.locator('.ant-modal-footer').getByRole('button', { name: '关闭', exact: true }).click()
  expect(await page.evaluate(async () => { const { projectSession } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-session.ts').at(-1) ?? '/src/project/project-session.ts'); return projectSession.getSnapshot() })).toEqual(before)
})
