import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function objectMenu(page: Page, action: string) {
  await page.locator('.city-layer-row__select').filter({ hasText: 'Tower' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

async function hasModelPixels(page: Page): Promise<boolean> {
  const png = await page.locator('.city-canvas__viewport canvas').screenshot()
  return page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0); bitmap.close()
    const pixels = context.getImageData(Math.floor(canvas.width * .25), Math.floor(canvas.height * .25), Math.floor(canvas.width * .5), Math.floor(canvas.height * .5)).data
    let count = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] > 20 && pixels[index + 1] > pixels[index] + 5 && pixels[index + 2] > pixels[index] + 10) count++
    }
    return count > 100
  }, [...png])
}

test('city document runtime retains a real model through edits, history and a failed resource retry', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  let modelRequests = 0, retryRequests = 0, available = false
  page.on('response', response => { if (response.url().endsWith('/city-sample/tower.glb')) modelRequests++ })
  await page.route('**/retry-model.glb', route => {
    retryRequests++
    return available ? route.fulfill({ contentType: 'model/gltf-binary', body: readFileSync(new URL('../../../examples/city-3d/city-sample/tower.glb', import.meta.url)) })
      : route.fulfill({ status: 503, body: 'Unavailable' })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.city-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  const document = { version: 3, id: 'city-runtime', title: 'City runtime', activeView: 'city', resources: {
    tower: { type: 'glb', url: './city-sample/tower.glb' }
  }, nodes: [{ type: 'model', id: 'tower', name: 'Tower', visible: true, resource: 'tower', position: [116.391, 39.907, 0],
    transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }], views: {
    city: { type: '3d', heightReference: 'ellipsoid', camera: { position: [116.391, 39.907, 2500], heading: 0, pitch: -45, roll: 0 } }
  } }
  await page.getByRole('button', { name: '未命名三维场景', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: 'city.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) })
  const row = page.locator('.city-layer-row').filter({ hasText: 'Tower' })
  await expect(row).toBeVisible()
  await expect(row.locator('small')).toHaveText('模型', { timeout: 30_000 })
  expect(modelRequests).toBe(1)
  await row.locator('.city-layer-row__select').dblclick()
  await expect.poll(() => hasModelPixels(page), { timeout: 20_000 }).toBe(true)
  const toggle = page.getByRole('checkbox', { name: '显示Tower', exact: true })
  await toggle.uncheck(); await expect(toggle).not.toBeChecked()
  await expect(page.locator('.city-footer__state')).toHaveText('就绪')
  await expect.poll(() => hasModelPixels(page)).toBe(false)
  await toggle.check(); await expect(toggle).toBeChecked()
  await expect(page.locator('.city-footer__state')).toHaveText('就绪')
  await expect.poll(() => hasModelPixels(page)).toBe(true)
  await objectMenu(page, '对象属性')
  const scale = page.getByRole('spinbutton', { name: '等比缩放', exact: true })
  await scale.fill('2'); await scale.press('Tab')
  await expect(scale).toHaveValue('2')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(scale).toHaveValue('1')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(scale).toHaveValue('2')
  expect(modelRequests).toBe(1)
  await page.getByRole('button', { name: 'City runtime', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出完整场景', exact: true }).click()
  const path = testInfo.outputPath('city-edited.scene.json')
  await (await download).saveAs(path)
  expect(JSON.parse(readFileSync(path, 'utf8')).nodes.find((node: { id: string }) => node.id === 'tower').transform.scale).toBe(2)
  await objectMenu(page, '数据源')
  await page.getByRole('textbox', { name: '资源地址', exact: true }).fill('./retry-model.glb')
  await page.getByRole('button', { name: '更新地址', exact: true }).click()
  await expect(row.locator('small')).toHaveText('加载失败 · 选择查看')
  await expect(page.getByRole('button', { name: '重试加载', exact: true })).toBeVisible()
  await expect(page.locator('.city-canvas__viewport canvas')).toBeVisible()
  await expect.poll(() => hasModelPixels(page)).toBe(true)
  available = true
  await page.getByRole('button', { name: '重试加载', exact: true }).click()
  await expect(row.locator('small')).toHaveText('模型', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: '重试加载', exact: true })).toHaveCount(0)
  expect(retryRequests).toBe(2)
  expect(modelRequests).toBe(1)
  await expect.poll(() => hasModelPixels(page)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('city-resource-recovered.png') })
})
