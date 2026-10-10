import { test, expect, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const fixture = (name: string) =>
  fileURLToPath(
    new URL(`../../../examples/phase-1/${name}.geojson`, import.meta.url)
  )
async function importLayer(page: Page, name: string) {
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page
    .getByRole('region', { name: '二维功能区' })
    .getByRole('button', { name: '添加数据', exact: true })
    .click()
  await page.locator('input[type=file]').setInputFiles(fixture(name))
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(
    page.locator('.layer-name-button').filter({ hasText: name })
  ).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  // 瓦片网络不参与交互验收；图层与处理全部使用真实导入和运行时。
  await page.route('**/*tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/')
  if (process.env.WORKBENCH_QA_FONT_CSS)
    await page.addStyleTag({
      content: readFileSync(process.env.WORKBENCH_QA_FONT_CSS, 'utf8')
    })
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.locator('[data-map-runtime="mounted"]')).toBeVisible()
})

test('start screen offers three work entries without duplicated navigation', async ({ page }, testInfo) => {
  await page.goto('/')
  const start = page.getByRole('main', { name: '项目起始页' })
  await expect(start.getByRole('button')).toHaveCount(3)
  await expect(start.getByRole('complementary')).toHaveCount(0)
  await expect(start).not.toContainText('工作路径')
  await page.screenshot({ path: testInfo.outputPath('start.png') })
})

test('CSV configuration keeps one modal and restores keyboard access after cancel', async ({ page }, testInfo) => {
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  const add = page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true })
  await add.click()
  await page.locator('input[type=file]').setInputFiles({
    name: 'coordinates.csv', mimeType: 'text/csv', buffer: Buffer.from('id,x,y\n1,116.4,39.9\n2,116.5,40.0')
  })
  const dialog = page.getByRole('dialog', { name: 'CSV 坐标', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page.locator('.dialog-overlay')).toHaveCount(1)
  await expect(dialog.getByLabel('经度 (X)', { exact: true })).toBeFocused()
  await dialog.getByLabel('坐标系', { exact: true }).selectOption('EPSG:3857')
  await expect(dialog.getByLabel('X (米)', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Y (米)', { exact: true })).toBeVisible()
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  await page.screenshot({ path: testInfo.outputPath('csv.png') })
  await dialog.getByLabel('坐标系', { exact: true }).selectOption('EPSG:4326')
  await dialog.getByRole('button', { name: /^确认/ }).click()
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toContainText('coordinates')
  await add.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(add).toBeFocused()
})

test('help and about open real dialogs with keyboard dismissal', async ({ page }) => {
  await page.getByRole('button', { name: '帮助', exact: true }).click()
  await page.getByRole('menuitem', { name: '操作帮助' }).click()
  const help = page.getByRole('dialog', { name: '操作帮助', exact: true })
  await expect(help).toContainText('Ctrl + S')
  await help.locator('summary').first().focus()
  await page.keyboard.press('Enter')
  await expect(help).toContainText('图层过滤影响地图和表格')
  await page.keyboard.press('Escape')
  await expect(help).toHaveCount(0)
  await page.getByRole('button', { name: '帮助', exact: true }).click()
  await page.getByRole('menuitem', { name: '关于', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '关于 Desktop WebGIS' })).toContainText('0.1.0')
})

test('table pagination, selected-only and selection commands retain their scope', async ({ page }) => {
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  const features = Array.from({ length: 105 }, (_, index) => ({
    type: 'Feature', id: `point-${index}`, properties: { value: index },
    geometry: { type: 'Point', coordinates: [116.4 + index * 0.0001, 39.9] }
  }))
  await page.locator('input[type=file]').setInputFiles({
    name: 'pagination.geojson', mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features }))
  })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const footer = page.getByLabel('表格状态与分页')
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(100)
  await footer.getByRole('button', { name: '下一页' }).click()
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(5)
  await expect(footer).toContainText('2 / 2')
  await page.getByRole('button', { name: '收起属性表' }).click()
  await page.getByRole('button', { name: '恢复属性表' }).click()
  await expect(footer).toContainText('2 / 2')
  await page.locator('.table-scroll tbody input[type=checkbox]').first().check()
  await page.getByLabel('仅选中', { exact: true }).check()
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await expect(footer).toContainText('显示 1 · 选中 1')
  await page.getByLabel('表内搜索').fill('does-not-match')
  await expect(footer).toContainText('显示 0 · 选中 1')
  await expect(footer).toContainText('0 / 0')
  await page.getByLabel('表内搜索').fill('')
  await page.getByLabel('仅选中', { exact: true }).uncheck()
  await page.locator('.attr-selection-actions summary').click()
  await page.getByRole('button', { name: '选择匹配记录', exact: true }).click()
  await expect(footer).toContainText('选中 105')
  await expect(page.locator('.attr-selection-actions')).not.toHaveAttribute('open')
  await page.locator('.attr-selection-actions summary').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.attr-selection-actions summary')).toBeFocused()
  await expect(page.locator('.attr-selection-actions')).not.toHaveAttribute('open')
})

test('default layout leaves the map dominant and restores panels explicitly', async ({
  page
}) => {
  await expect(
    page.getByRole('complementary', { name: '检查器面板' })
  ).toBeHidden()
  await expect(
    page.getByRole('complementary', { name: '属性表面板' })
  ).toBeHidden()
  await expect(page.locator('.map-onboarding')).toHaveCount(0)
  await expect(page.locator('.workbench-group-label')).toHaveCount(0)
  await expect(page.locator('.layer-manager').getByRole('button', { name: '添加数据', exact: true })).toBeVisible()
  const map = await page
    .getByRole('region', { name: '地图工作区' })
    .boundingBox()
  expect(map!.width).toBeGreaterThan((page.viewportSize()?.width ?? 0) * 0.6)
  await page.getByRole('tab', { name: '视图', exact: true }).click()
  await page.getByRole('button', { name: '图层属性', exact: true }).click()
  await expect(
    page.getByRole('complementary', { name: '检查器面板' })
  ).toBeVisible()
  await page.getByRole('button', { name: '收起右侧面板' }).click()
})

test('table binding survives browsing; filters apply explicitly and scope stays visible', async ({
  page
}, testInfo) => {
  await importLayer(page, 'points')
  await importLayer(page, 'lines')
  await page.locator('.layer-name-button').filter({ hasText: 'points' }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const selected = await page.getByLabel('属性表图层').inputValue()
  await page.locator('.layer-name-button').filter({ hasText: 'lines' }).click()
  await expect(page.getByLabel('属性表图层')).toHaveValue(selected)
  await expect(page.getByLabel('图层字段过滤')).toBeHidden()
  await expect(page.getByLabel('字段统计', { exact: true })).toBeHidden()
  const toolbar = page.getByLabel('属性表工具')
  const footer = page.getByLabel('表格状态与分页')
  expect((await toolbar.boundingBox())!.height + (await footer.boundingBox())!.height).toBeLessThanOrEqual(64)
  await expect(page.locator('.panel-bottom .panel-header')).toHaveCount(0)
  const panelBounds = (await page.getByRole('complementary', { name: '属性表面板' }).boundingBox())!
  const mapBounds = (await page.getByRole('region', { name: '地图工作区' }).boundingBox())!
  expect(Math.abs(panelBounds.y - mapBounds.y - mapBounds.height)).toBeLessThanOrEqual(2)
  await page.getByLabel('表内搜索').fill('does-not-match')
  await expect(footer).toContainText('显示 0')
  await expect(page.locator('.table-scroll')).toContainText('无匹配记录')
  await page.getByLabel('表内搜索').fill('')
  await expect(footer).not.toContainText('显示 0')
  await page
    .getByRole('button', { name: /^图层过滤/ })
    .last()
    .click()
  const filter = page.getByLabel('图层字段过滤')
  await filter.locator('select').first().selectOption({ index: 1 })
  await filter.getByPlaceholder('值', { exact: true }).fill('does-not-match')
  await filter.getByRole('button', { name: '添加条件' }).click()
  await expect(page.locator('.table-scroll tbody tr')).not.toHaveCount(0)
  await filter.getByRole('button', { name: '应用过滤' }).click()
  await expect(page.locator('.table-scroll')).toContainText('无匹配记录')
  await expect(footer).toContainText('过滤后 0')
  await filter.getByRole('button', { name: '清除过滤' }).click()
  await expect(page.locator('.table-scroll')).not.toContainText('无匹配记录')
  await page
    .getByRole('button', { name: /^图层过滤/ })
    .last()
    .click()
  await page.locator('.layer-name-button').filter({ hasText: 'points' }).click()
  await page.getByRole('button', { name: '样式', exact: true }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '定位图层' }).click()
  await page.screenshot({ path: testInfo.outputPath('workbench.png') })
})

test('editing has a locked target and style switches require a draft decision', async ({
  page
}) => {
  await importLayer(page, 'points')
  await importLayer(page, 'lines')
  await page.locator('.layer-name-button').filter({ hasText: 'points' }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑' }).click()
  await page.locator('.layer-name-button').filter({ hasText: 'lines' }).click()
  await expect(page.locator('.workbench-context strong')).toContainText(
    'points'
  )
  await page
    .getByRole('button', { name: '结束编辑', exact: true })
    .last()
    .click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.locator('.layer-name-button').filter({ hasText: 'points' }).click()
  await page.getByRole('button', { name: '样式', exact: true }).click()
  await page.getByLabel('符号颜色', { exact: true }).fill('#ff0000')
  await page.getByLabel('配置图层').selectOption({ label: 'lines' })
  await expect(page.getByRole('dialog', { name: '样式尚未应用' })).toBeVisible()
  await page.getByRole('button', { name: '取消切换' }).click()
  await expect(page.getByLabel('符号颜色', { exact: true })).toHaveValue(
    '#ff0000'
  )
  await page.getByLabel('配置图层').selectOption({ label: 'lines' })
  await page.getByRole('button', { name: '应用并切换' }).click()
  await expect(page.getByRole('dialog', { name: '样式尚未应用' })).toBeHidden()
})

test('processing runs in a dock and creates a real result layer', async ({
  page
}, testInfo) => {
  await importLayer(page, 'points')
  await page.getByRole('tab', { name: '分析', exact: true }).click()
  await page.getByRole('button', { name: '空间处理', exact: true }).click()
  await expect(page.getByRole('region', { name: '空间处理参数' })).toBeVisible()
  await expect(page.locator('.dialog-overlay')).toHaveCount(0)
  await page
    .getByRole('combobox', { name: '处理工具', exact: true })
    .selectOption('buffer')
  await page.getByLabel('缓冲距离', { exact: true }).fill('100')
  await page.getByLabel('结果图层名称', { exact: true }).fill('测试缓冲区')
  await page.getByRole('button', { name: '生成结果图层' }).click()
  await expect(
    page.locator('.layer-name-button').filter({ hasText: '测试缓冲区' })
  ).toBeVisible()
  await expect(page.locator('.processing-result')).toContainText('结果')
  await page.screenshot({ path: testInfo.outputPath('processing.png') })
})

test('three-dimensional workspace keeps scene capabilities and shared panel rules', async ({
  page
}, testInfo) => {
  await page.goto('/')
  if (process.env.WORKBENCH_QA_FONT_CSS)
    await page.addStyleTag({
      content: readFileSync(process.env.WORKBENCH_QA_FONT_CSS, 'utf8')
    })
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.city-workspace .workbench-ribbon')).toBeVisible()
  await expect(page.locator('.city-canvas__viewport canvas')).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: '检查器面板' })
  ).toBeHidden()
  await page.getByRole('button', { name: '场景', exact: true }).click()
  await page.getByRole('button', { name: '光照与时间', exact: true }).click()
  await expect(
    page.getByText('光照与时间', { exact: true }).last()
  ).toBeVisible()
  await expect(
    page.locator('.city-properties details').filter({ hasText: '底图与地形' })
  ).not.toHaveAttribute('open', '')
  await expect(page.getByRole('button', { name: '应用场景设置' })).toHaveCount(0)
  const sunlight = page.getByRole('checkbox', { name: '太阳光照' })
  const initialSunlight = await sunlight.isChecked()
  await sunlight.setChecked(!initialSunlight)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(sunlight).toBeChecked({ checked: initialSunlight })
  await page.locator('.city-properties summary').filter({ hasText: '环境效果' }).click()
  const fog = page.getByRole('spinbutton', { name: '雾浓度', exact: true })
  await fog.fill('0.2')
  await fog.press('Tab')
  await fog.fill('2')
  await fog.press('Tab')
  await expect(page.getByRole('alert')).toContainText('雾浓度必须在 0–1 之间')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(fog).toHaveValue('0')
  await page.screenshot({ path: testInfo.outputPath('city.png') })
})
