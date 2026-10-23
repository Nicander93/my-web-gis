import assert from 'node:assert/strict'
import { expect } from '@playwright/test'

const style = { color: 'color("#c77b40")', meta: { name: '${name}' } }

export async function verifyNativeSceneEditor(page, report) {
  const row = page.locator('.scene3d-layer-row').filter({ hasText: 'Native nested Tileset' })
  await row.locator('.scene3d-layer-row__select').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '瓦片样式', exact: true }).click()
  const inspector = page.getByRole('complementary', { name: '检查器面板' })
  await inspector.getByRole('button', { name: '编辑瓦片样式', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '完整属性：Native nested Tileset', exact: true })
  await dialog.getByText('Style JSON', { exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Cesium3DTileStyle JSON', exact: true }).fill(JSON.stringify(style))
  await dialog.getByRole('button', { name: '确定', exact: true }).click()
  await expect.poll(() => readNativeTileset(page)).toMatchObject({ style })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal((await readNativeTileset(page)).style, undefined)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(() => readNativeTileset(page)).toMatchObject({ style })
  await inspector.getByRole('tab', { name: '配置', exact: true }).click()
  const error = inspector.getByRole('spinbutton', { name: 'maximumScreenSpaceError', exact: true })
  await error.fill('8'); await error.press('Tab')
  await expect.poll(() => readNativeTileset(page)).toMatchObject({ style, maximumScreenSpaceError: 8 })
  report.sceneEditorLayouts = []
  for (const [width, height] of [[1440, 900], [1024, 680]]) {
    const viewport = { requested: { width, height } }
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(async ({ width, height }) => {
        const { getCurrentWindow, PhysicalSize } = await import('/node_modules/@tauri-apps/api/window.js')
        const window = getCurrentWindow()
        const current = await window.innerSize()
        await window.setSize(new PhysicalSize(current.width + Math.round((width - innerWidth) * devicePixelRatio), current.height + Math.round((height - innerHeight) * devicePixelRatio)))
      }, { width, height })
      await expect.poll(() => page.evaluate(({ width, height }) => Math.abs(innerWidth - width) <= 1 && Math.abs(innerHeight - height) <= 1, { width, height })).toBe(true)
      if (await page.evaluate(({ width, height }) => innerWidth === width && innerHeight === height, { width, height })) break
    }
    await expect.poll(() => page.evaluate(() => ({ width: innerWidth, height: innerHeight }))).toEqual({ width, height })
    const rail = page.getByRole('navigation', { name: '右侧工作面板' })
    await expect(rail.getByRole('button', { name: '属性', exact: true })).toBeVisible()
    await inspector.getByRole('button', { name: '完整属性', exact: true }).click()
    const complete = page.getByRole('dialog', { name: '完整属性：Native nested Tileset', exact: true })
    const reachable = await complete.getByRole('button', { name: '确定', exact: true }).evaluate(button => {
      const bounds = button.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      return button === hit || button.contains(hit)
    })
    assert.equal(reachable, true, 'Property action must be reachable in the actual native viewport')
    await complete.getByRole('button', { name: '取消', exact: true }).click()
    report.sceneEditorLayouts.push({ ...viewport, actual: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), propertyActionReachable: reachable })
  }
  report.webgl = await page.evaluate(() => {
    const context = document.querySelector('.scene3d-canvas canvas')?.getContext('webgl2')
    const extension = context?.getExtension('WEBGL_debug_renderer_info')
    return context ? { version: context.getParameter(context.VERSION), renderer: extension ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER) } : null
  })
  report.scenarios.push({ name: 'Native scene workrail, tileset style/history, parameters and property actions at exact 1440x900 and 1024x680 CSS viewports', passed: true })
}

export async function verifyNativeSceneEditorReopen(page, report) {
  await expect.poll(() => readNativeTileset(page)).toMatchObject({ style, maximumScreenSpaceError: 8 })
  const presentation = await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const node = useProjectStore.getState().project.city.nodes.find(node => node.type === '3dtiles')
    return (await import('/src/features/scene3d/scene3d-runtime-host.ts')).getLiveSceneDiagnostics(node.id)?.presentation?.tileset
  })
  assert.deepEqual(JSON.parse(JSON.stringify(presentation.style)), style)
  assert.equal(presentation.maximumScreenSpaceError, 8)
  report.scenarios.push({ name: 'Native persisted style and parameters restore on real local nested tileset after process restart', passed: true })
}

async function readNativeTileset(page) {
  return page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().project.city.nodes.find(node => node.type === '3dtiles'))
}
