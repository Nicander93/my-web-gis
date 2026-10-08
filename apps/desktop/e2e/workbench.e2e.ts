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

test('default layout leaves the map dominant and restores panels explicitly', async ({
  page
}) => {
  await expect(
    page.getByRole('complementary', { name: '检查器面板' })
  ).toBeHidden()
  await expect(
    page.getByRole('complementary', { name: '属性表面板' })
  ).toBeHidden()
  await expect(
    page
      .getByRole('region', { name: '地图工作区' })
      .getByRole('button', { name: '添加数据', exact: true })
  ).toBeVisible()
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
