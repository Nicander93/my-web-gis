import { expect, test, type Locator } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })
const sample = { type: 'FeatureCollection', features: Array.from({ length: 36 }, (_, index) => ({ type: 'Feature', id: `survey-${index}`, geometry: { type: 'Point', coordinates: [116.39 + index * .0001, 39.9] }, properties: {
  code: `BJ-${index}`, name: `测量站 ${index}`, height: 42.5 + index, category: index % 2 ? '水准点' : '控制点', active: true, district: '东城区', date: '2026-10-18', note: '实际 GIS 要素属性与完整长文本'
} })) }
async function height(locator: Locator) { return locator.evaluate(node => node.getBoundingClientRect().height) }

test('disabled reasons are keyboard accessible and quick actions use the embedded icon size', async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  const disabled = page.locator('.ribbon-tool-anchor').filter({ has: page.getByRole('button', { name: '定位图层', exact: true }) })
  await disabled.focus()
  await expect(page.getByRole('tooltip')).toHaveText('请先选择图层')
  await expect(disabled.getByRole('button')).toBeDisabled()
  expect(await height(page.locator('.workbench-quick').getByRole('button', { name: '撤销', exact: true }))).toBe(24)
  expect(await height(page.getByRole('button', { name: '平移', exact: true }))).toBe(34)
  await page.getByRole('tab', { name: '地图', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '编辑', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('End')
  await expect(page.getByRole('tab', { name: '分析', exact: true })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Home')
  await expect(page.getByRole('tab', { name: '地图', exact: true })).toHaveAttribute('aria-selected', 'true')
})

test('real survey table has four zones, stable row geometry, floating state and shared dark tokens', async ({ page }, info) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'survey.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sample)) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const panel = page.getByRole('complementary', { name: '属性表面板' })
  const measure = async () => ({
    chrome: await height(page.locator('.window-bar')),
    ribbonTabs: await height(page.locator('.workbench-ribbon-top')),
    ribbonTools: await height(page.locator('.workbench-ribbon-commands')),
    tool: await height(page.getByRole('button', { name: '平移', exact: true })),
    title: await height(panel.locator('.dock-window__title')),
    toolbar: await height(panel.getByLabel('属性表工具', { exact: true })),
    header: await height(panel.locator('.ant-table-thead tr').first()),
    row: await height(panel.locator('.ant-table-tbody tr').first()),
    footer: await height(panel.getByLabel('表格状态与分页'))
  })
  await expect(panel.locator('.ant-table-tbody tr')).toHaveCount(36)
  await expect(panel.getByRole('columnheader')).toHaveCount(11)
  await info.attach('cell-layout.json', { body: JSON.stringify(await panel.locator('.ant-table-tbody tr').first().locator('td').evaluateAll(nodes => nodes.map(node => ({ html: node.innerHTML.slice(0, 300), height: node.getBoundingClientRect().height, padding: getComputedStyle(node).padding, lineHeight: getComputedStyle(node).lineHeight, children: Array.from(node.children).map(child => ({ height: child.getBoundingClientRect().height, lineHeight: getComputedStyle(child).lineHeight })) }))), null, 2), contentType: 'application/json' })
  writeFileSync(info.outputPath('cell-layout.json'), JSON.stringify(await panel.locator('.ant-table-tbody tr').first().locator('td').evaluateAll(nodes => nodes.map(node => ({ html: node.innerHTML.slice(0, 500), height: node.getBoundingClientRect().height, padding: getComputedStyle(node).padding, children: Array.from(node.children).map(child => ({ height: child.getBoundingClientRect().height, display: getComputedStyle(child).display, padding: getComputedStyle(child).padding })) }))), null, 2))
  await expect.poll(measure).toEqual({ chrome: 40, ribbonTabs: 31, ribbonTools: 43, tool: 34, title: 36, toolbar: 40, header: 32, row: 30, footer: 29 })
  expect(await height(panel.locator('.table-scroll'))).toBeGreaterThan(100)
  const canvasBefore = await page.getByTestId('map-runtime-viewport').boundingBox()
  const docked = await panel.boundingBox(), workspace = await page.getByRole('main').boundingBox()
  expect(docked!.width).toBeCloseTo(workspace!.width, 0)
  await panel.getByRole('button', { name: '浮动属性表', exact: true }).click()
  await expect(panel).toHaveClass(/dock-window--floating/)
  await expect(panel.locator('.ant-table-tbody tr')).toHaveCount(36)
  expect(await page.getByTestId('map-runtime-viewport').boundingBox()).toEqual(canvasBefore)
  await panel.locator('.table-scroll').evaluate(node => { node.scrollLeft = 160; node.scrollTop = 90 })
  await expect.poll(() => panel.locator('.table-scroll').evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop }))).toEqual({ x: 160, y: 90 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await expect.poll(() => panel.locator('.ant-table').evaluate(node => getComputedStyle(node).color)).toBe('rgb(237, 240, 236)')
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim())).toBe('#93b39a')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await info.attach('geometry.json', { body: JSON.stringify(await measure(), null, 2), contentType: 'application/json' })
})

test('3D real tileset property frame keeps footer reachable, vector layout and API search', async ({ page }, info) => {
  test.setTimeout(90_000)
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await page.getByRole('button', { name: '使用三维示例', exact: true }).click()
  const row = page.locator('.scene3d-layer-row').filter({ hasText: '建筑场景' })
  await expect(row.locator('small')).toHaveText('3D Tiles', { timeout: 30_000 })
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  await expect(page.getByRole('region', { name: '三维功能区' }).getByRole('group', { name: '浏览', exact: true })).toBeVisible()
  await row.locator('.scene3d-layer-row__select').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '完整属性', exact: true }).click()
  const dialog = page.locator('.scene-property-window')
  const vectors = await dialog.locator('.property-vector').first().locator('input').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y))
  expect(vectors).toHaveLength(3)
  expect(new Set(vectors).size).toBe(1)
  expect(await height(dialog.getByRole('textbox', { name: '对象名称', exact: true }))).toBe(30)
  const before = await page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().getSnapshot())
  await dialog.getByLabel('搜索属性字段', { exact: true }).fill('maximumScreenSpaceError')
  await expect(dialog.getByRole('spinbutton', { name: '屏幕误差（px）', exact: true })).toBeVisible()
  await expect(dialog.getByText('当前分类：样式与参数')).toBeVisible()
  for (const name of ['取消', '应用', '确定']) {
    const button = dialog.getByRole('button', { name, exact: true })
    const box = (await button.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
    expect(await button.evaluate(node => { const b = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)) })).toBe(true)
  }
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect(await page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().getSnapshot())).toEqual(before)
  await info.attach('property-frame.json', { body: JSON.stringify({ vectorColumns: 3, nativeTileset: true, viewport: page.viewportSize() }), contentType: 'application/json' })
})

test('independent POI icon draft preserves IME, cancel, history and saved project values', async ({ page }, info) => {
  test.setTimeout(90_000)
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await page.evaluate(async () => {
    const { updateScene } = await import('/src/features/scene3d/scene3d-commands.ts')
    updateScene('POI 验收样本', scene => {
      scene.nodes.push({ type: 'graphic', id: 'visual-poi', name: '观测站 POI', visible: true, geometry: { type: 'point', heightMode: 'ground', positions: [[116.391, 39.907, 0]] }, properties: { code: 'BJ-018' }, style: { color: '#2f695b', width: 2, pointSize: 10 } })
      return scene
    })
  })
  const row = page.locator('.scene3d-layer-row__select').filter({ hasText: '观测站 POI' })
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '完整属性', exact: true }).click()
  const dialog = page.locator('.scene-property-window')
  await dialog.getByRole('textbox', { name: '对象名称', exact: true }).dispatchEvent('keydown', { key: 'Escape', isComposing: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('menuitem', { name: '样式与参数', exact: true }).click()
  await dialog.getByRole('switch', { name: '启用 Billboard 图标', exact: true }).click()
  await expect.poll(() => dialog.getByAltText('当前 POI 图标').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await dialog.getByRole('spinbutton', { name: '图标宽度', exact: true }).fill('48')
  await dialog.getByRole('button', { name: '应用', exact: true }).click()
  await dialog.getByRole('spinbutton', { name: '图标宽度', exact: true }).fill('72')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  const poi = () => page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().project.city!.nodes.find(node => node.id === 'visual-poi'))
  expect(await poi()).toMatchObject({ style: { billboard: { width: 48 } } })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await poi()).not.toHaveProperty('style.billboard')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(await poi()).toMatchObject({ style: { billboard: { width: 48 } } })
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const file = info.outputPath('poi.webgis.json')
  await (await downloading).saveAs(file)
  expect(JSON.parse(readFileSync(file, 'utf8')).project.city.nodes[0]).toEqual(await poi())
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await chooser).setFiles(file)
  await expect.poll(poi).toMatchObject({ style: { billboard: { width: 48 } } })
})
