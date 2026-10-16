import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.use({ actionTimeout: 15_000, screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })
async function snapshot(page: Page) { return page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().getSnapshot()) }
async function native(page: Page, id: string) { return page.evaluate(async id => (await import('/src/features/scene3d/scene3d-runtime-host.ts')).getLiveSceneDiagnostics(id)?.presentation?.graphic, id) }

for (const [type,label] of [['rectangle','矩形'],['ellipse','椭圆']] as const) {
  test(`${type} two-corner draw, fixed controls, cancel, atomic history and file reopen`, async ({ page }, info) => {
    test.setTimeout(120_000)
    await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
    await page.goto('/')
    await page.getByRole('button', { name: /^三维场景/ }).click()
    await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
    await page.getByRole('tab', { name: '标绘', exact: true }).click()
    await page.getByRole('button', { name: `绘制${label}`, exact: true }).click()
    const canvas = page.locator('.scene3d-canvas__viewport canvas'), bounds = (await canvas.boundingBox())!
    await page.mouse.click(bounds.x + bounds.width * .46,bounds.y + bounds.height * .46)
    expect((await snapshot(page)).project.city?.nodes).toHaveLength(0)
    await page.mouse.move(bounds.x + bounds.width * .54,bounds.y + bounds.height * .54)
    await page.mouse.click(bounds.x + bounds.width * .54,bounds.y + bounds.height * .54)
    await expect.poll(async () => (await snapshot(page)).project.city?.nodes.length).toBe(1)
    const before = await snapshot(page), node = before.project.city!.nodes[0]
    if (node.type !== 'graphic') throw new Error('Expected graphic')
    expect(node.geometry.type).toBe(type); expect(node.geometry.positions).toHaveLength(2)
    await expect.poll(() => native(page,node.id)).toHaveProperty(type)
    const originalNative = await native(page,node.id)
    expect(originalNative?.point).toBe(false)
    if (type === 'ellipse') {
      expect(originalNative?.ellipse?.semiMajorAxis).toBeGreaterThan(0)
      expect(originalNative?.ellipse?.semiMinorAxis).toBeGreaterThan(0)
    }
    await page.getByRole('button', { name: `绘制${label}`, exact: true }).click()
    await page.mouse.click(bounds.x + bounds.width * .5,bounds.y + bounds.height * .5)
    await page.keyboard.press('Escape')
    expect((await snapshot(page)).project.city?.nodes).toEqual(before.project.city?.nodes)
    await page.locator('.scene3d-layer-row__select').filter({ hasText: node.name }).click()
    await page.getByRole('tab', { name: '编辑', exact: true }).click()
    await page.getByRole('button', { name: '编辑顶点', exact: true }).click()
    await expect(page.getByRole('button', { name: '后方插入', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '删除顶点', exact: true })).toBeDisabled()
    const longitude = node.geometry.positions[0][0] - .001
    await page.getByRole('spinbutton', { name: '顶点经度（度）', exact: true }).fill('')
    await expect(page.getByRole('button', { name: '预览坐标', exact: true })).toBeDisabled()
    await page.getByRole('spinbutton', { name: '顶点经度（度）', exact: true }).fill(String(longitude))
    await page.getByRole('button', { name: '预览坐标', exact: true }).click()
    await expect.poll(() => native(page,node.id)).not.toEqual(originalNative)
    expect((await snapshot(page)).project.city?.nodes).toEqual(before.project.city?.nodes)
    await page.keyboard.press('Escape')
    await expect.poll(() => native(page,node.id)).toEqual(originalNative)
    await page.getByRole('button', { name: '编辑顶点', exact: true }).click()
    await page.getByRole('spinbutton', { name: '顶点经度（度）', exact: true }).fill(String(longitude))
    await page.getByRole('button', { name: '预览坐标', exact: true }).click()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await snapshot(page)).project.city?.nodes).not.toEqual(before.project.city?.nodes)
    const after = await snapshot(page)
    await page.getByRole('button', { name: '撤销', exact: true }).click()
    expect((await snapshot(page)).project.city?.nodes).toEqual(before.project.city?.nodes)
    await page.getByRole('button', { name: '重做', exact: true }).click()
    expect((await snapshot(page)).project.city?.nodes).toEqual(after.project.city?.nodes)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '保存项目', exact: true }).click()
    const path = info.outputPath(`${type}.webgis.json`)
    await (await download).saveAs(path)
    const saved = JSON.parse(readFileSync(path,'utf8'))
    expect(saved.project.city.nodes[0].geometry.type).toBe(type)
    await page.getByRole('button', { name: '文件', exact: true }).click()
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('menuitem', { name: /^打开/ }).click()
    await (await chooser).setFiles(path)
    expect((await snapshot(page)).project.city?.nodes).toEqual(saved.project.city.nodes)
    await expect.poll(() => native(page,node.id)).toHaveProperty(type)
  })
}
