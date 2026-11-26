import { expect, test, type Page } from '@playwright/test'

async function toggleWindow(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
}

test.use({ screenshot: 'off', trace: 'off' })

test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
})

test('起始页和三维工作台只显示当前可用的菜单项', async ({ page }) => {
  await expect(page.getByRole('button', { name: '操作', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '窗口', exact: true })).toHaveCount(0)
  await page.keyboard.press('F10')
  const file = page.getByRole('button', { name: '文件', exact: true })
  await expect(file).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('button', { name: '帮助', exact: true })).toBeFocused()
  await file.click()
  await expect(page.getByRole('menuitem', { name: /^保存/ })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: '导入场景', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '三维场景', exact: true }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: '场景树', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitemcheckbox', { name: '属性表', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  const scene = page.getByRole('main', { name: '三维场景编辑器' })
  const canvas = page.locator('.scene3d-canvas__viewport')
  const bounds = await canvas.boundingBox()
  expect(bounds?.x).toBe(0)
  expect(bounds?.width).toBe(page.viewportSize()?.width)
  await scene.getByRole('tab', { selected: true }).press('End')
  await expect(scene.getByRole('tab', { name: '分析', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(scene.getByRole('button', { name: '保存项目', exact: true })).toBeInViewport()
  expect(await canvas.boundingBox()).toEqual(bounds)
})

test('工程通过读取校验后才询问是否替换当前工作', async ({ page }, info) => {
  await page.getByRole('button', { name: '二维地图', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const cleanPath = info.outputPath('clean.webgis.json')
  await (await download).saveAs(cleanPath)

  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({
    name: '当前工作.geojson', mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [116, 40] }, properties: { value: 2 } }]
    }))
  })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.locator('.layer-name-button').filter({ hasText: '当前工作' })).toBeVisible()
  const confirmation = page.getByRole('dialog', { name: '保存当前项目？' })

  const open = async () => {
    await page.getByRole('button', { name: '文件', exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: /^打开/ }).click()
    return chooser
  }
  const invalid = await open()
  await expect(confirmation).toHaveCount(0)
  await invalid.setFiles({ name: 'invalid.webgis.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.locator('.status-message')).toContainText('打开失败')
  await expect(confirmation).toHaveCount(0)
  await expect(page.locator('.layer-name-button').filter({ hasText: '当前工作' })).toBeVisible()

  await page.locator('.layer-name-button').filter({ hasText: '当前工作' }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const table = page.locator('.attribute-table-tab-panel:visible')
  await table.getByRole('button', { name: '开始属性编辑', exact: true }).click()
  await table.getByRole('button', { name: '字段计算器', exact: true }).click()
  const calculator = page.getByRole('dialog', { name: '字段计算器', exact: true })
  await calculator.getByText('更新已有字段', { exact: true }).click()
  await calculator.getByLabel('更新字段', { exact: true }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^value$/ }).click()
  await calculator.getByLabel('字段计算表达式').fill('7')
  await calculator.getByRole('button', { name: '应用计算', exact: true }).click()
  await expect(calculator.getByRole('status')).toContainText('1 条')
  await calculator.getByRole('button', { name: '关闭字段计算器', exact: true }).click()
  const value = table.getByRole('cell', { name: '7', exact: true })
  await expect(value).toBeVisible()
  const configOnly = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  await configOnly
  await expect(page.getByText('配置已保存', { exact: true })).toBeVisible()
  await expect(page.getByText('数据待提交', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.getByRole('menuitem', { name: /^新建/ }).click()
  const creating = page.getByRole('dialog', { name: '新建项目', exact: true })
  await expect(creating.getByText(/^还有 [1-9]\d* 条数据修改待提交。$/)).toBeVisible()
  await expect(creating.getByRole('button', { name: '创建项目', exact: true })).toHaveCount(0)
  await creating.getByRole('button', { name: '取消', exact: true }).click()
  await expect(value).toContainText('7')

  await (await open()).setFiles(cleanPath)
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('.layer-name-button').filter({ hasText: '当前工作' })).toBeVisible()

  await (await open()).setFiles(cleanPath)
  await expect(confirmation).toBeVisible()
  await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/project/project.store.ts')
    const { layerConfigurationCommands } = await import('/src/commands/layer-configuration.commands.ts')
    layerConfigurationCommands.setLayerOpacity(useProjectStore.getState().project.content.layers[0].id, 0.8)
  })
  await confirmation.getByRole('button', { name: '放弃修改并打开', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('确认期间项目已改变')
  await expect(value).toContainText('7')

  await (await open()).setFiles(cleanPath)
  await confirmation.getByRole('button', { name: '放弃修改并打开', exact: true }).click()
  await expect(page.locator('.layer-name-button').filter({ hasText: '当前工作' })).toHaveCount(0)
})

test('三维绘制有未完成顶点时，新建命令保留编辑现场', async ({ page }) => {
  await page.getByRole('button', { name: '三维场景', exact: true }).click()
  const footer = page.locator('.scene3d-footer__state')
  await expect(footer).toHaveText('就绪', { timeout: 30_000 })
  await page.getByRole('tab', { name: '标绘', exact: true }).click()
  await page.getByRole('button', { name: '绘制线', exact: true }).click()
  const viewport = await page.locator('.scene3d-canvas__viewport').boundingBox()
  expect(viewport).not.toBeNull()
  await page.mouse.click(viewport!.x + viewport!.width / 2, viewport!.y + viewport!.height / 2)
  await expect(page.locator('.scene3d-drawing-bar')).toContainText('1 个顶点')
  await page.keyboard.press('Control+n')
  await expect(footer).toHaveText('请先完成或取消当前绘制。')
  await expect(page.getByRole('dialog', { name: '新建项目', exact: true })).toHaveCount(0)
  await expect(page.locator('.scene3d-drawing-bar')).toContainText('1 个顶点')
  await page.locator('.scene3d-drawing-bar').getByRole('button', { name: '取消', exact: true }).click()
  await page.keyboard.press('Control+n')
  await expect(page.getByRole('dialog', { name: '新建项目', exact: true })).toBeVisible()
})

test('停靠窗快速收起和展开时，画布保持原位，减少动态效果立即生效', async ({ page }) => {
  await page.getByRole('button', { name: '二维地图', exact: true }).click()
  const canvas = page.locator('.map-canvas__viewport')
  const original = await canvas.boundingBox()
  const panel = page.locator('.dock-window.panel-bottom')
  await toggleWindow(page, '属性表')
  await expect(panel).not.toHaveAttribute('inert')
  await page.getByRole('button', { name: '关闭属性表窗口', exact: true }).click()
  await expect(panel).toHaveAttribute('inert', '')
  await expect(page.getByRole('complementary', { name: '属性表面板' })).toHaveCount(0)
  await toggleWindow(page, '属性表')
  await expect(panel).not.toHaveAttribute('inert')
  await expect(panel).toHaveCSS('opacity', '1')
  expect(await canvas.boundingBox()).toEqual(original)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(panel).toHaveCSS('transition-duration', '0s, 0s')
  await page.getByRole('button', { name: '关闭属性表窗口', exact: true }).click()
  await expect(panel).toHaveCSS('visibility', 'hidden')
  expect(await canvas.boundingBox()).toEqual(original)
})

test('记录长属性表的窗口过渡帧间隔，深色模式下不移动地图', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => localStorage.setItem('desktop-webgis.preferences', JSON.stringify({
    state: { theme: 'system', density: 'compact', fontSize: 12 }, version: 1
  })))
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system')
  await page.getByRole('button', { name: '二维地图', exact: true }).click()
  await page.evaluate(async () => {
    const path = '/src/commands/layer-content.commands.ts'
    const url = performance.getEntriesByType('resource').map(entry => entry.name).findLast(name => new URL(name).pathname === path)
    const { layerContentCommands } = await import(url ?? path)
    layerContentCommands.addLayer('motion-data', '帧率测试', Array.from({ length: 5000 }, (_, index) => ({
      id: `row-${index}`, geometry: { type: 'Point', coordinates: [116 + index / 100000, 40] }, properties: { index }
    })), 'point')
  })
  await page.locator('.layer-name-button').filter({ hasText: '帧率测试' }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const canvas = page.locator('.map-canvas__viewport')
  const bounds = await canvas.boundingBox()
  expect(bounds?.x).toBe(0)
  expect(bounds?.width).toBe(page.viewportSize()?.width)
  const panel = page.locator('.dock-window.panel-bottom')
  await expect(panel).toHaveCSS('opacity', '1')
  await page.getByRole('button', { name: '窗口', exact: true }).click()

  const { frames, longFrames } = await page.getByRole('menuitemcheckbox', { name: '属性表', exact: true }).evaluate(button => {
    const intervals: number[] = []
    interface LongFrameScript {
      sourceURL: string
      sourceFunctionName: string
      duration: number
      forcedStyleAndLayoutDuration: number
    }
    const longFrames: Array<{ duration: number; blockingDuration: number; scripts: LongFrameScript[] }> = []
    return new Promise<{ frames: number[]; longFrames: typeof longFrames }>(resolve => {
      requestAnimationFrame(start => {
        const observer = new PerformanceObserver(list => {
          for (const frame of list.getEntries() as Array<PerformanceEntry & { blockingDuration: number; scripts: LongFrameScript[] }>) {
            longFrames.push({ duration: frame.duration, blockingDuration: frame.blockingDuration,
              scripts: frame.scripts.map(script => ({
                sourceURL: script.sourceURL,
                sourceFunctionName: script.sourceFunctionName,
                duration: script.duration,
                forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration
              })) })
          }
        })
        if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) observer.observe({ type: 'long-animation-frame' })
        let previous = start
        button.click()
        const frame = (time: number) => {
          intervals.push(time - previous)
          previous = time
          if (intervals.length < 20) {
            requestAnimationFrame(frame)
            return
          }
          observer.disconnect()
          resolve({ frames: intervals, longFrames })
        }
        requestAnimationFrame(frame)
      })
    })
  })
  const sorted = [...frames].sort((a, b) => a - b)
  const metrics = { viewport: page.viewportSize(), rows: 5000, frames, longFrames, p95Ms: sorted[18], maxMs: sorted.at(-1) }
  await info.attach('属性表收起帧间隔', { body: JSON.stringify(metrics), contentType: 'application/json' })
  console.log('属性表收起帧间隔', JSON.stringify(metrics))
  await expect(panel).toHaveCSS('visibility', 'hidden')
  expect(await canvas.boundingBox()).toEqual(bounds)
})
