import { expect, test, type Page } from '@playwright/test'

async function transform(page: Page) {
  return page.evaluate(async () => {
    const node = (await import('/src/stores/project.store.ts')).useProjectStore.getState().project.city?.nodes.find(node => node.type === '3dtiles')
    return node?.type === '3dtiles' ? node.transform : null
  })
}

async function modelTransform(page: Page) {
  return page.evaluate(async () => {
    const node = (await import('/src/stores/project.store.ts')).useProjectStore.getState().project.city?.nodes.find(node => node.type === 'model')
    return node?.type === 'model' ? node.transform : null
  })
}

async function redAxisHandle(page: Page): Promise<{ x: number; y: number; dx: number; dy: number }> {
  const canvas = page.locator('.scene3d-canvas__viewport canvas'), bounds = (await canvas.boundingBox())!
  const png = [...await canvas.screenshot()]
  const point = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const surface = document.createElement('canvas'); surface.width = bitmap.width; surface.height = bitmap.height
    const context = surface.getContext('2d')!; context.drawImage(bitmap, 0, 0); bitmap.close()
    const pixels = context.getImageData(0, 0, surface.width, surface.height).data
    const points: Array<[number, number]> = []
    for (let y = 0; y < surface.height; y++) for (let x = 0; x < surface.width; x++) {
      const offset = (y * surface.width + x) * 4, red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2]
      if (red > 175 && red > green * 1.45 && red > blue * 1.3 && pixels[offset + 3] > 200) points.push([x, y])
    }
    if (points.length < 12) throw new Error(`未找到红色 Gizmo 轴，候选像素 ${points.length}`)
    const right = Math.max(...points.map(value => value[0]))
    const arrow = points.filter(value => value[0] >= right - 16)
    const y = arrow.reduce((sum, value) => sum + value[1] / arrow.length, 0)
    return { x: right - 10, y, dx: 1, dy: 0 }
  }, png)
  return { x: bounds.x + point.x, y: bounds.y + point.y, dx: point.dx, dy: point.dy }
}

async function dragAxis(page: Page, cancel = false): Promise<void> {
  // Cesium's locate animation keeps moving the handle after the edit toolbar is ready.
  // Wait for its default flight duration before resolving screen-space coordinates.
  await page.waitForTimeout(3500)
  const handle = await redAxisHandle(page)
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.dx * 55, handle.y + handle.dy * 55, { steps: 8 })
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
}

test('real pointer drag commits one tileset transform and Esc rolls back an active gesture', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await page.getByRole('button', { name: '使用三维示例', exact: true }).click()
  const row = page.locator('.scene3d-layer-row').filter({ hasText: '建筑场景' })
  await expect(row.locator('small')).toHaveText('3D Tiles', { timeout: 30_000 })
  await row.locator('.scene3d-layer-row__select').dblclick()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '移动', exact: true }).click()
  await expect(page.getByText('移动', { exact: true }).last()).toBeVisible()
  expect(await transform(page)).toMatchObject({ translation: [0,0,0] })

  await dragAxis(page)
  await expect.poll(async () => (await transform(page))?.translation.some(value => Math.abs(value) > .01)).toBe(true)
  const committed = await transform(page)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => transform(page)).toMatchObject({ translation: [0,0,0] })
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(() => transform(page)).toEqual(committed)

  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => transform(page)).toMatchObject({ translation: [0,0,0] })
  await dragAxis(page, true)
  await expect.poll(() => transform(page)).toMatchObject({ translation: [0,0,0] })
  await page.screenshot({ path: testInfo.outputPath('scene3d-gizmo-pointer.png') })
})

test('real pointer drag also commits a GLB model transform', async ({ page }) => {
  test.setTimeout(90_000)
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  const scene = { version: 3, id: 'gizmo-model', title: 'Gizmo model', activeView: 'scene',
    resources: { tower: { type: 'glb', url: './city-sample/tower.glb' } },
    nodes: [{ type: 'model', id: 'tower', name: 'Tower', visible: true, resource: 'tower', position: [116.391,39.907,0], transform: { translation: [0,0,0], rotation: [0,0,0], scale: 1 } }],
    views: { scene: { type: '3d', heightReference: 'ellipsoid', camera: { position: [116.391,39.907,2500], heading: 0, pitch: -45, roll: 0 } } } }
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: 'gizmo-model.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) })
  const row = page.locator('.scene3d-layer-row').filter({ hasText: 'Tower' })
  await expect(row.locator('small')).toHaveText('模型', { timeout: 30_000 })
  await row.locator('.scene3d-layer-row__select').dblclick()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '移动', exact: true }).click()
  await dragAxis(page)
  await expect.poll(async () => (await modelTransform(page))?.translation.some(value => Math.abs(value) > .01)).toBe(true)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => modelTransform(page)).toMatchObject({ translation: [0,0,0] })
})
