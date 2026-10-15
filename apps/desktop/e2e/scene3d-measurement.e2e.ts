import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function draw(page: Page, tool: string, points: Array<[number, number]>) {
  await page.getByRole('button', { name: tool, exact: true }).click()
  const canvas = page.locator('.scene3d-canvas__viewport canvas')
  const bounds = (await canvas.boundingBox())!
  for (const [x, y] of points) await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y)
  await page.keyboard.press('Enter')
  return page.getByRole('region', { name: '三维测量结果' })
}

async function measurementCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const nodes = (await import('/src/stores/project.store.ts')).useProjectStore.getState().project.city?.nodes ?? []
    return nodes.filter(node => node.type === 'graphic' && typeof node.properties.measurementKind === 'string').length
  })
}

async function projectDirty(page: Page): Promise<boolean> {
  return page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().dirty)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await page.getByRole('tab', { name: '分析', exact: true }).click()
})

test('four measurement tools stay transient until retained and then support history and save', async ({ page }, testInfo: TestInfo) => {
  test.setTimeout(90_000)
  const line: Array<[number, number]> = [[.46,.51],[.54,.49]]
  const polygon: Array<[number, number]> = [[.45,.54],[.55,.54],[.52,.44]]

  for (const [tool, points, unit] of [
    ['贴地距离', line, /m|km/],
    ['面积', polygon, /m²|km²/],
    ['高度差', line, /m/]
  ] as const) {
    const card = await draw(page, tool, [...points])
    await expect(card).toBeVisible()
    await expect(card.getByText('临时结果，尚未写入项目')).toBeVisible()
    await expect(card.locator('output')).toHaveText(unit)
    expect(await measurementCount(page)).toBe(0)
    expect(await projectDirty(page)).toBe(false)
    await card.getByRole('button', { name: '清除', exact: true }).click()
    await expect(card).toHaveCount(0)
  }

  const card = await draw(page, '空间距离', line)
  await expect(card.locator('output')).toHaveText(/m|km/)
  expect(await measurementCount(page)).toBe(0)
  expect(await projectDirty(page)).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('scene3d-measurement-transient.png') })
  await card.getByRole('button', { name: '保留测量', exact: true }).click()
  await expect(card).toHaveCount(0)
  expect(await measurementCount(page)).toBe(1)
  expect(await projectDirty(page)).toBe(true)
  await expect(page.locator('.scene3d-layer-row').filter({ hasText: '空间距离 1' })).toBeVisible()

  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => measurementCount(page)).toBe(0)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(() => measurementCount(page)).toBe(1)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = testInfo.outputPath('scene3d-measurement.webgis.json')
  await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  expect(saved.project.city.nodes).toContainEqual(expect.objectContaining({
    type: 'graphic', name: '空间距离 1', properties: expect.objectContaining({ measurementKind: 'spatial-distance', measurementUnit: 'm' })
  }))
  await page.screenshot({ path: testInfo.outputPath('scene3d-measurement-retained.png') })
})
