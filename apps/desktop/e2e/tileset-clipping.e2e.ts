import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function openSampleTileset(page: import('@playwright/test').Page) {
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
  return row
}

async function canvasPixels(page: import('@playwright/test').Page): Promise<number[]> {
  return [...await page.locator('.scene3d-canvas__viewport canvas').screenshot()]
}

async function changedPixels(page: import('@playwright/test').Page, before: number[], after: number[]): Promise<number> {
  return page.evaluate(async ({ before, after }) => {
    async function pixels(bytes: number[]) {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
      return context.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const first = await pixels(before), second = await pixels(after)
    let changed = 0
    for (let index = 0; index < first.length; index += 4) if (Math.abs(first[index] - second[index]) + Math.abs(first[index + 1] - second[index + 1]) + Math.abs(first[index + 2] - second[index + 2]) > 30) changed++
    return changed
  }, { before, after })
}

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
  await openSampleTileset(page)
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
  await expect(page.locator('.scene3d-property-group').filter({ hasText: '多边形裁剪' }).getByText('尚未添加范围')).toBeVisible()
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

test('flattens real tileset geometry at a configurable ellipsoid height and restores it', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await openSampleTileset(page)
  const canvas = page.locator('.scene3d-canvas__viewport canvas'), before = await canvasPixels(page)
  await page.getByRole('button', { name: '局部压平', exact: true }).click()
  const bounds = (await canvas.boundingBox())!
  for (const [x, y] of [[.43,.38],[.57,.38],[.58,.62],[.42,.62]]) await page.mouse.click(bounds.x + bounds.width * x, bounds.y + bounds.height * y)
  await page.keyboard.press('Enter')
  const height = page.getByRole('spinbutton', { name: '压平目标高程 1' })
  await expect(height).toBeVisible(); await height.fill('0'); await height.press('Enter')
  await expect(page.getByRole('switch', { name: '启用压平范围 1' })).toBeChecked()
  await expect(page.locator('.scene3d-footer__state')).not.toHaveClass(/scene3d-footer__state--error/)
  await expect(page.locator('.scene3d-layer-row').filter({ hasText: '建筑场景' }).locator('small')).toHaveText('3D Tiles')
  await page.waitForTimeout(500)
  const flattened = await canvasPixels(page)
  expect(await changedPixels(page, before, flattened)).toBeGreaterThan(200)
  await page.screenshot({ path: testInfo.outputPath('tileset-flattened.png') })
  await page.getByRole('switch', { name: '启用压平范围 1' }).click()
  await page.waitForTimeout(500)
  const restored = await canvasPixels(page)
  expect(await changedPixels(page, before, restored)).toBeLessThan(await changedPixels(page, before, flattened))
  const stored = await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const node = useProjectStore.getState().project.city?.nodes.find(item => item.type === '3dtiles')
    return node?.type === '3dtiles' ? node.effects : undefined
  })
  expect(stored).toEqual([expect.objectContaining({ kind: 'flatten-polygon', enabled: false, height: 0 })])
  await page.screenshot({ path: testInfo.outputPath('tileset-flatten-restored.png') })

  await page.getByRole('switch', { name: '启用压平范围 1' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const projectPath = testInfo.outputPath('tileset-flatten.webgis.json')
  await (await download).saveAs(projectPath)
  const saved = JSON.parse(readFileSync(projectPath, 'utf8'))
  expect(saved.project.city.nodes.find((node: { type: string }) => node.type === '3dtiles').effects)
    .toEqual([expect.objectContaining({ kind: 'flatten-polygon', enabled: true, height: 0 })])

  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await chooser).setFiles(projectPath)
  const reopenedRow = page.locator('.scene3d-layer-row').filter({ hasText: '建筑场景' })
  await expect(reopenedRow.locator('small')).toHaveText('3D Tiles', { timeout: 30_000 })
  await reopenedRow.locator('.scene3d-layer-row__select').click()
  await page.getByRole('tab', { name: '瓦片', exact: true }).click()
  await expect(page.getByRole('switch', { name: '启用压平范围 1' })).toBeChecked()
  await expect(page.getByRole('spinbutton', { name: '压平目标高程 1' })).toHaveValue('0')
  await expect(page.locator('.scene3d-footer__state')).not.toHaveClass(/scene3d-footer__state--error/)
  await page.waitForTimeout(500)
  expect(await changedPixels(page, before, await canvasPixels(page))).toBeGreaterThan(200)
  await page.screenshot({ path: testInfo.outputPath('tileset-flatten-reopened.png') })
})

test('keeps flatten shaders isolated across differently transformed tilesets', async ({ page }) => {
  test.setTimeout(90_000)
  const base = [
    [116.38978453464809, 39.908773712103034, 0],
    [116.39221546485824, 39.90877370867839, 0],
    [116.39220112663507, 39.90655797954571, 0],
    [116.3897988728253, 39.90655798232819, 0]
  ]
  const shifted = (longitude: number) => base.map(([x, y, z]) => [x + longitude, y, z])
  const effect = (id: string, longitude: number, height: number) => ({
    id, kind: 'flatten-polygon', enabled: false, height, positions: shifted(longitude)
  })
  const document = {
    version: 3, id: 'two-transformed-tilesets', title: '双实例压平', activeView: 'scene',
    resources: { buildings: { type: '3dtiles', url: './city-sample/tileset.json' } },
    nodes: [
      { type: '3dtiles', id: 'west', name: '西侧建筑', resource: 'buildings', visible: true,
        transform: { translation: [-180, 0, 0], rotation: [0, 0, 0], scale: 1 }, effects: [effect('west-flat', -0.0021, 0)] },
      { type: '3dtiles', id: 'east', name: '东侧建筑', resource: 'buildings', visible: true,
        transform: { translation: [180, 0, 0], rotation: [0, 0, 0], scale: 1 }, effects: [effect('east-flat', 0.0021, 8)] }
    ],
    views: { scene: { type: '3d', heightReference: 'ellipsoid', camera: {
      position: [116.391, 39.89999187563917, 843.2823120051911], heading: 0, pitch: -45, roll: 0
    } } }
  }
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: 'two-transformed.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) })
  const west = page.locator('.scene3d-layer-row').filter({ hasText: '西侧建筑' })
  const east = page.locator('.scene3d-layer-row').filter({ hasText: '东侧建筑' })
  await expect(west.locator('small')).toHaveText('3D Tiles', { timeout: 30_000 })
  await expect(east.locator('small')).toHaveText('3D Tiles', { timeout: 30_000 })
  const canvas = page.locator('.scene3d-canvas__viewport canvas')

  await west.locator('.scene3d-layer-row__select').click()
  const inspector = page.getByRole('complementary', { name: '检查器面板' })
  if (!await inspector.isVisible()) {
    await page.getByRole('button', { name: '窗口', exact: true }).click()
    await page.getByRole('menuitemcheckbox', { name: '检查器', exact: true }).click()
  }
  await page.getByRole('tab', { name: '瓦片', exact: true }).click()
  const westBefore = await canvasPixels(page)
  await page.getByRole('switch', { name: '启用压平范围 1' }).click()
  await page.waitForTimeout(500)
  expect(await changedPixels(page, westBefore, await canvasPixels(page))).toBeGreaterThan(100)

  await east.locator('.scene3d-layer-row__select').click()
  await expect(page.getByRole('spinbutton', { name: '压平目标高程 1' })).toHaveValue('8')
  const eastBefore = await canvasPixels(page)
  await page.getByRole('switch', { name: '启用压平范围 1' }).click()
  await page.waitForTimeout(500)
  expect(await changedPixels(page, eastBefore, await canvasPixels(page))).toBeGreaterThan(100)

  await west.locator('.scene3d-layer-row__select').click()
  await page.getByRole('switch', { name: '启用压平范围 1' }).click()
  const state = await page.evaluate(async () => {
    const nodes = (await import('/src/stores/project.store.ts')).useProjectStore.getState().project.city?.nodes ?? []
    return nodes.filter(node => node.type === '3dtiles').map(node => ({ id: node.id, transform: node.transform, effects: node.effects }))
  })
  expect(state).toEqual([
    expect.objectContaining({ id: 'west', transform: expect.objectContaining({ translation: [-180, 0, 0] }), effects: [expect.objectContaining({ enabled: false, height: 0 })] }),
    expect.objectContaining({ id: 'east', transform: expect.objectContaining({ translation: [180, 0, 0] }), effects: [expect.objectContaining({ enabled: true, height: 8 })] })
  ])
  await expect(page.locator('.scene3d-footer__state')).not.toHaveClass(/scene3d-footer__state--error/)
})
