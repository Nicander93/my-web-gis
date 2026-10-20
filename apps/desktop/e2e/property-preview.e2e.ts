import { expect, test, type Page } from '@playwright/test'
import { createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'

async function content(page: Page) {
  return page.evaluate(async () => {
    const module = await import('/src/stores/project.store.ts')
    return { snapshot: module.useProjectStore.getState().getSnapshot(), version: module.getProjectContentVersion() }
  })
}
async function opacity(page: Page, id: string) {
  return page.evaluate(async id => (await import('/src/features/map/map-runtime-host.ts')).getMapRuntime()?.registry.get(id)?.getOpacity(), id)
}
async function presentation(page: Page, id: string) {
  return page.evaluate(async id => (await import('/src/features/scene3d/scene3d-runtime-host.ts')).getLiveSceneDiagnostics(id)?.presentation, id)
}
async function pendingPropertyEdits(page: Page) {
  return page.evaluate(async () => (await import('/src/services/pending-property-edits.ts')).hasPendingPropertyEdits())
}
test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })
test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
})

test('2D live preview stays outside content history and cancel restores the latest applied opacity', async ({ page }) => {
  test.setTimeout(90_000)
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'preview.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [116.4, 39.9] } }] })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.locator('.layer-item').filter({ hasText: 'preview' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '完整属性', exact: true }).click()
  const dialog = page.locator('.scene-property-window'), before = await content(page), id = before.snapshot.project.layers[0].id
  await dialog.getByRole('switch', { name: '实时预览', exact: true }).click()
  await dialog.getByRole('spinbutton', { name: '不透明度', exact: true }).fill('35')
  await expect.poll(() => pendingPropertyEdits(page)).toBe(true)
  await expect.poll(() => opacity(page, id)).toBe(.35)
  expect(await content(page)).toEqual(before)
  await dialog.getByRole('switch', { name: '实时预览', exact: true }).click()
  await expect.poll(() => opacity(page, id)).toBe(1)
  await dialog.getByRole('switch', { name: '实时预览', exact: true }).click()
  await dialog.getByRole('button', { name: '应用', exact: true }).click()
  await expect.poll(() => pendingPropertyEdits(page)).toBe(false)
  const applied = await content(page)
  expect(applied.snapshot.project.layers[0].opacity).toBe(.35)
  await dialog.getByRole('spinbutton', { name: '不透明度', exact: true }).fill('60')
  await expect.poll(() => opacity(page, id)).toBe(.6)
  expect(await content(page)).toEqual(applied)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(() => pendingPropertyEdits(page)).toBe(false)
  await expect.poll(() => opacity(page, id)).toBe(.35)
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => opacity(page, id)).toBe(1)
  expect((await content(page)).snapshot.project.layers[0].opacity).toBe(1)
  await page.locator('.layer-item').filter({ hasText: 'preview' }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: '完整属性', exact: true }).click()
  await dialog.getByRole('switch', { name: '实时预览', exact: true }).click()
  await dialog.getByRole('spinbutton', { name: '不透明度', exact: true }).fill('20')
  await expect.poll(() => opacity(page, id)).toBe(.2)
  await page.evaluate(async id => (await import('/src/stores/project.store.ts')).useProjectStore.getState().setLayerOpacity(id, .7), id)
  await expect.poll(() => opacity(page, id)).toBe(.7)
  const external = await content(page)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(() => opacity(page, id)).toBe(.7)
  expect(await content(page)).toEqual(external)
})

test('3D native visibility previews and cancel restores the latest applied state', async ({ page }) => {
  test.setTimeout(90_000)
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await page.getByRole('button', { name: '使用三维示例', exact: true }).click()
  const row = page.locator('.scene3d-layer-row').filter({ hasText: '建筑场景' })
  await expect(row.locator('small')).toHaveText('3D Tiles', { timeout: 30_000 })
  await row.locator('.scene3d-layer-row__select').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '完整属性', exact: true }).click()
  const dialog = page.locator('.scene-property-window'), before = await content(page), id = before.snapshot.project.city!.nodes[0].id
  await dialog.getByRole('switch', { name: '实时预览', exact: true }).click()
  await dialog.getByRole('switch', { name: '显示对象', exact: true }).click()
  await expect.poll(() => pendingPropertyEdits(page)).toBe(true)
  await expect.poll(() => presentation(page, id)).toMatchObject({ visible: false })
  expect(await content(page)).toEqual(before)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(() => pendingPropertyEdits(page)).toBe(false)
  await expect.poll(() => presentation(page, id)).toMatchObject({ visible: true })
  expect(await content(page)).toEqual(before)
  await row.locator('.scene3d-layer-row__select').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '完整属性', exact: true }).click()
  await dialog.getByRole('switch', { name: '实时预览', exact: true }).click()
  await dialog.getByRole('switch', { name: '显示对象', exact: true }).click()
  await dialog.getByRole('button', { name: '应用', exact: true }).click()
  await expect.poll(async () => (await content(page)).snapshot.project.city?.nodes[0].visible).toBe(false)
  const applied = await content(page)
  await dialog.getByRole('switch', { name: '显示对象', exact: true }).click()
  await expect.poll(() => presentation(page, id)).toMatchObject({ visible: true })
  expect(await content(page)).toEqual(applied)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect.poll(() => presentation(page, id)).toMatchObject({ visible: false })
  expect(await content(page)).toEqual(applied)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => presentation(page, id)).toMatchObject({ visible: true })
  expect((await content(page)).snapshot.project.city?.nodes[0].visible).toBe(true)
})

test('GLB anchor and static water parameters preview without committing or reloading model data', async ({ page }) => {
  test.setTimeout(120_000)
  let modelRequests = 0
  page.on('response', response => { if (response.url().endsWith('/city-sample/tower.glb')) modelRequests++ })
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  const scene = (() => {
    const scene = createCesiumScene()
    scene.assets.tower = { type: 'glb', url: './city-sample/tower.glb' }
    scene.nodes = [{ id: 'tower', name: 'Tower', type: 'model', asset: 'tower', position: [116.391,39.907,0], transform: createTransform(), visible: true },
      { id: 'water', name: 'Water', type: 'water', visible: true, height: 0, color: '#238bafcc', amplitude: 4, frequency: 1000, speed: 0, boundary: [[116.39,39.906,0],[116.392,39.906,0],[116.392,39.908,0],[116.39,39.908,0]] }]
    return scene
  })()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: 'preview.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) })
  for (const [name, field, value] of [['Tower', '椭球高度（m）', '100'], ['Water', '水面高度（m）', '40']]) {
    const row = page.locator('.scene3d-layer-row').filter({ hasText: name })
    await expect(row.locator('small')).toHaveText(name === 'Tower' ? '模型' : '水面', { timeout: 30_000 })
    await row.locator('.scene3d-layer-row__select').click({ button: 'right' })
    await page.getByRole('menuitem', { name: '完整属性', exact: true }).click()
    const dialog = page.locator('.scene-property-window')
    if (name === 'Water') await dialog.getByRole('menuitem', { name: '样式与参数', exact: true }).click()
    const before = await content(page), id = before.snapshot.project.city!.nodes.find(node => node.name === name)!.id
    await dialog.getByRole('switch', { name: '实时预览', exact: true }).click()
    await dialog.getByRole('spinbutton', { name: field, exact: true }).fill(value)
    await expect.poll(async () => { const state = await presentation(page, id); return name === 'Tower' ? state?.position?.[2] : state?.water?.height }).toBeCloseTo(Number(value), 3)
    expect(await content(page)).toEqual(before)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await expect.poll(async () => { const state = await presentation(page, id); return name === 'Tower' ? state?.position?.[2] : state?.water?.height }).toBeCloseTo(0, 3)
    expect(await content(page)).toEqual(before)
  }
  expect(modelRequests).toBe(1)
})
