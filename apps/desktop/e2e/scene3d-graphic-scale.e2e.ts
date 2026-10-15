import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function diagnostics(page: Page) {
  return page.evaluate(async () => (await import('/src/features/scene3d/scene3d-runtime-host.ts')).getLiveSceneDiagnostics())
}

test('500 independent graphics share one native container and retain scoped batch edits', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  const nodes = Array.from({ length: 500 }, (_, index) => ({
    type: 'graphic', id: `poi-${index}`, name: `POI ${String(index).padStart(4, '0')}`, visible: true,
    geometry: { type: 'point', heightMode: 'ground', positions: [[116.386 + (index % 25) * .0004, 39.902 + Math.floor(index / 25) * .00035, 0]] },
    style: { color: index % 2 ? '#d18b47' : '#2f7655', width: 3, pointSize: 8 }, properties: { sequence: index }
  }))
  const scene = { version: 3, id: 'graphic-scale', title: '500 POI', activeView: 'scene', resources: {}, nodes,
    views: { scene: { type: '3d', heightReference: 'ellipsoid', camera: { position: [116.391,39.899,1600], heading: 0, pitch: -48, roll: 0 } } } }
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: '500-poi.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) })
  await expect(page.locator('.scene3d-layer-row')).toHaveCount(500, { timeout: 60_000 })
  await expect.poll(() => diagnostics(page), { timeout: 60_000 }).toMatchObject({ sceneObjects: 500, graphicObjects: 500, managedLayers: 500, dataSources: 1 })

  await page.getByRole('button', { name: '搜索对象', exact: true }).click()
  const search = page.getByRole('textbox', { name: '搜索场景对象' })
  await search.fill('POI 0499')
  await expect(page.locator('.scene3d-layer-row')).toHaveCount(1)
  await expect(page.locator('.scene3d-layer-row')).toContainText('POI 0499')
  await search.fill('')
  await expect(page.locator('.scene3d-layer-row')).toHaveCount(500)

  const rows = page.locator('.scene3d-layer-row__select')
  await rows.nth(0).click()
  await page.keyboard.down('Control')
  for (let index = 1; index < 10; index++) await rows.nth(index).click()
  await page.keyboard.up('Control')
  const inspector = page.getByRole('complementary', { name: '检查器面板' })
  if (!await inspector.isVisible()) {
    await page.getByRole('button', { name: '窗口', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: '检查器', exact: true }).click()
  }
  await expect(inspector.getByText('已选择 10 个对象', { exact: false })).toBeVisible()
  await inspector.getByRole('button', { name: '全部隐藏', exact: true }).click()
  const state = await page.evaluate(async () => {
    const graphics = (await import('/src/stores/project.store.ts')).useProjectStore.getState().project.city?.nodes.filter(node => node.type === 'graphic') ?? []
    return { hidden: graphics.filter(node => !node.visible).map(node => node.id), untouched: graphics.slice(10).every(node => node.visible) }
  })
  expect(state).toEqual({ hidden: Array.from({ length: 10 }, (_, index) => `poi-${index}`), untouched: true })
  await expect.poll(() => diagnostics(page)).toMatchObject({ graphicObjects: 500, dataSources: 1 })

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = testInfo.outputPath('500-poi.webgis.json')
  await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  expect(saved.project.city.nodes).toHaveLength(500)
  expect(saved.project.city.nodes[499]).toMatchObject({ id: 'poi-499', style: { color: '#d18b47', pointSize: 8 }, geometry: { positions: [[116.3956,39.90865,0]] } })

  await page.getByRole('button', { name: '文件', exact: true }).click()
  const reopen = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await reopen).setFiles(path)
  await expect(page.locator('.scene3d-layer-row')).toHaveCount(500, { timeout: 60_000 })
  await expect.poll(() => diagnostics(page), { timeout: 60_000 }).toMatchObject({ sceneObjects: 500, graphicObjects: 500, dataSources: 1 })
  await page.screenshot({ path: testInfo.outputPath('scene3d-500-poi.png') })
})
