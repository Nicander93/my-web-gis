import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

test('exported Desktop classification renders unchanged in Viewer with complete legend and visibility', async ({ page, context }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await context.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../../../examples/phase-1/points.geojson', import.meta.url)))
  await page.getByRole('dialog', { name: '添加数据', exact: true }).getByRole('button', { name: '确认导入', exact: true }).click()
  await page.locator('.layer-name-button').click()
  await page.getByRole('button', { name: '样式', exact: true }).click()
  const panel = page.locator('.style-panel')
  await panel.getByLabel('模式').selectOption('categorized')
  await panel.getByLabel('字段').selectOption('name')
  await panel.getByRole('button', { name: '重新分类', exact: true }).click()
  for (const [name, color] of [['北京市中心', '#ff0000'], ['上海市中心', '#00ff00'], ['广州市中心', '#0000ff']]) {
    await panel.getByLabel(`分类 ${name} 颜色`, { exact: true }).fill(color)
  }
  await panel.getByRole('button', { name: '应用', exact: true }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    return getMapRuntime()!.getMap().getView().getAnimating()
  })).toBe(false)
  await page.getByRole('button', { name: '项目', exact: true }).click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: '导出完整场景', exact: true }).click()
  const download = await downloadEvent
  const body = readFileSync((await download.path())!)
  const scene = JSON.parse(body.toString('utf8'))
  await info.attach('exported-scene', { body, contentType: 'application/json' })
  expect(scene.version).toBe(3)
  const vector = scene.nodes.find((node: { type: string }) => node.type === 'vector')
  expect(vector.style.mode).toBe('categorized')
  expect(vector.style.categories).toHaveLength(3)
  expect(vector.style.categories.find((item: { value: string }) => item.value === '北京市中心').symbol.fill).toEqual({ r: 255, g: 0, b: 0, a: 1 })

  const viewer = await context.newPage()
  await viewer.bringToFront()
  viewer.on('pageerror', error => errors.push(error.message))
  await viewer.route('**/acceptance.scene.json', route => route.fulfill({ contentType: 'application/json', body }))
  await viewer.goto('http://127.0.0.1:5178/?scene=./acceptance.scene.json&mode=2d')
  await expect(viewer.locator('#scene-status')).toHaveText('场景已加载')
  const legend = viewer.locator('#legend-list')
  for (const name of ['北京市中心', '上海市中心', '广州市中心', '其他']) await expect(legend).toContainText(name)
  await expect(legend.locator('.legend-row')).toHaveCount(4)
  await expect.poll(() => coloredMapPixels(viewer)).toEqual([true, true, true])
  const visibility = viewer.locator('#layer-list').getByRole('checkbox', { name: vector.name, exact: true })
  await visibility.uncheck()
  await expect.poll(() => coloredMapPixels(viewer)).toEqual([false, false, false])
  await visibility.check()
  await expect.poll(() => coloredMapPixels(viewer)).toEqual([true, true, true])
  await viewer.screenshot({ path: info.outputPath('desktop-scene-in-viewer.png') })

  await viewer.route('**/hidden-widgets.scene.json', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ ...scene, widgets: { legend: false, layerSwitcher: false } })
  }))
  await viewer.goto('http://127.0.0.1:5178/?scene=./hidden-widgets.scene.json&mode=2d')
  await expect(viewer.locator('#scene-status')).toHaveText('场景已加载')
  await expect(viewer.locator('#legend-panel')).toBeHidden()
  await expect(viewer.locator('#layer-panel')).toBeHidden()
  await expect.poll(() => coloredMapPixels(viewer)).toEqual([true, true, true])
  expect(errors).toEqual([])
})

// Inspect actual rendered pixels, independently of the exported style declarations.
async function coloredMapPixels(page: Page) {
  return page.locator('#map canvas').evaluateAll(canvases => {
    const counts = [0, 0, 0]
    for (const canvas of canvases as HTMLCanvasElement[]) {
      const context = canvas.getContext('2d')
      if (!context) continue
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 200) continue
        for (let channel = 0; channel < 3; channel++) {
          if (data[i + channel] > 220 && data[i + (channel + 1) % 3] < 30 && data[i + (channel + 2) % 3] < 30) counts[channel]++
        }
      }
    }
    return counts.map(count => count >= 10)
  })
}
