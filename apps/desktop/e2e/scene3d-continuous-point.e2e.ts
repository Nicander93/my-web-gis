import { expect, test } from '@playwright/test'

async function pointCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(async () => {
    const nodes = (await import('/src/stores/project.store.ts')).useProjectStore.getState().project.city?.nodes ?? []
    return nodes.filter(node => node.type === 'graphic' && node.geometry.type === 'point').length
  })
}

test('continuous point placement commits each click and Esc releases the tool', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await page.getByRole('tab', { name: '标绘', exact: true }).click()
  await page.getByRole('button', { name: '绘制点', exact: true }).click()
  await expect(page.getByText('连续放置点 · 单击创建，Esc 退出', { exact: true })).toBeVisible()

  const canvas = page.locator('.scene3d-canvas__viewport canvas'), bounds = (await canvas.boundingBox())!
  for (const [index, [x, y]] of [[.44,.5],[.5,.46],[.56,.52]].entries()) {
    await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y)
    await expect.poll(() => pointCount(page), { timeout: 30_000 }).toBe(index + 1)
    await expect(page.getByText('连续放置点 · 单击创建，Esc 退出', { exact: true })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(page.getByText('连续放置点 · 单击创建，Esc 退出', { exact: true })).toHaveCount(0)
  await page.mouse.click(bounds.x + bounds.width * .6, bounds.y + bounds.height * .48)
  await page.waitForTimeout(300)
  expect(await pointCount(page)).toBe(3)

  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => pointCount(page)).toBe(2)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(() => pointCount(page)).toBe(3)
  await page.screenshot({ path: testInfo.outputPath('scene3d-continuous-points.png') })
})
