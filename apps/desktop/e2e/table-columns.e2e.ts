import { test, expect, type Page } from '@playwright/test'

async function importTable(page: Page, name: string) {
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: `${name}.geojson`, mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: 12 }, (_, index) => ({
      type: 'Feature', id: `${name}-${index}`, properties: { value: index, code: '0007',
        ...Object.fromEntries(Array.from({ length: 9 }, (_, field) => [`field${field}`, `Record ${index}`])) },
      geometry: { type: 'Point', coordinates: [116 + index / 100, 39] }
    })) })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
}

test('column drag, keyboard, cancellation and rename retain per-table widths without layout history', async ({ page }, info) => {
  await page.route('**/*tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await importTable(page, 'first')
  const panel = () => page.locator('.attribute-table-tab-panel:visible')
  const handle = () => panel().getByRole('separator', { name: '调整 value 列宽', exact: true })
  const header = () => panel().getByRole('columnheader', { name: 'value', exact: true })
  const before = await page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().getSnapshot())
  await expect(handle()).toHaveAttribute('aria-valuenow', '160')
  const original = (await header().boundingBox())!
  const bounds = (await handle().boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 + 40, bounds.y + bounds.height / 2)
  await page.mouse.up()
  await expect(handle()).toHaveAttribute('aria-valuenow', '200')
  expect((await header().boundingBox())!.width).toBeCloseTo(original.width + 40, 0)
  await expect(header()).toHaveAttribute('aria-sort', 'none')
  const resized = (await handle().boundingBox())!
  await page.mouse.move(resized.x + resized.width / 2, resized.y + resized.height / 2)
  await page.mouse.down()
  await page.mouse.move(resized.x + resized.width / 2 + 20, resized.y + resized.height / 2)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(handle()).toHaveAttribute('aria-valuenow', '200')
  await handle().focus()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(handle()).toHaveAttribute('aria-valuenow', '232')
  expect(await page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().getSnapshot())).toEqual(before)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeEnabled()
  await page.screenshot({ path: info.outputPath('consistent-attribute-table.png') })

  await importTable(page, 'second')
  await expect(handle()).toHaveAttribute('aria-valuenow', '160')
  await page.getByRole('tab', { name: 'first', exact: true }).click()
  await expect(handle()).toHaveAttribute('aria-valuenow', '232')
  await page.locator('.layer-name-button').filter({ hasText: /^first$/ }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  await panel().getByRole('button', { name: '字段列表', exact: true }).click()
  await panel().getByRole('button', { name: '重命名字段 value', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重命名字段', exact: true })
  await dialog.getByLabel('字段名称').fill('score')
  await dialog.getByRole('button', { name: '应用字段修改', exact: true }).click()
  await expect(panel().getByRole('separator', { name: '调整 score 列宽', exact: true })).toHaveAttribute('aria-valuenow', '232')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(handle()).toHaveAttribute('aria-valuenow', '232')
  await panel().getByRole('button', { name: '重置列显示', exact: true }).click()
  await expect(handle()).toHaveAttribute('aria-valuenow', '160')
  // Only the two imports remain after undoing the rename; layout edits add no history.
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toHaveCount(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
})
