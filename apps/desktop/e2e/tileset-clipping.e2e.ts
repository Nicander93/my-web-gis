import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
})

test('draws and manages persistent native clipping ranges without reloading the tileset', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  let tilesetRequests = 0
  page.on('response', response => { if (response.url().endsWith('/city-sample/tileset.json')) tilesetRequests++ })
  await page.getByRole('button', { name: '使用三维示例', exact: true }).click()
  const row = page.locator('.scene3d-layer-row').filter({ hasText: '建筑场景' })
  await expect(row.locator('small')).toHaveText('3D Tiles', { timeout: 30_000 })
  await row.locator('.scene3d-layer-row__select').click()
  const inspector = page.getByRole('complementary', { name: '检查器面板' })
  if (!await inspector.isVisible()) {
    await page.getByRole('button', { name: '窗口', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: '检查器', exact: true }).click()
  }
  await page.getByRole('tab', { name: '瓦片', exact: true }).click()
  await page.getByRole('button', { name: '多边形裁剪', exact: true }).click()
  const canvas = page.locator('.scene3d-canvas__viewport canvas')
  const bounds = (await canvas.boundingBox())!
  for (const [x, y] of [[.4,.4],[.6,.4],[.62,.62],[.38,.62]]) await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y)
  await page.keyboard.press('Enter')
  await expect(page.getByText('范围 1 · 4 个控制点', { exact: true })).toBeVisible()
  expect(tilesetRequests).toBe(1)

  const enabled = page.getByRole('switch', { name: '启用裁剪范围 1' })
  await enabled.click(); await expect(enabled).not.toBeChecked()
  await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(enabled).toBeChecked()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByText('尚未添加范围')).toBeVisible()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByText('范围 1 · 4 个控制点', { exact: true })).toBeVisible()
  expect(tilesetRequests).toBe(1)

  const stored = await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const node = useProjectStore.getState().project.city?.nodes.find(item => item.type === '3dtiles')
    return node?.type === '3dtiles' ? node.effects : undefined
  })
  expect(stored).toEqual([expect.objectContaining({ kind: 'clip-polygon', enabled: true, mode: 'keep-inside' })])
  await page.screenshot({ path: testInfo.outputPath('tileset-clipping.png') })
})
