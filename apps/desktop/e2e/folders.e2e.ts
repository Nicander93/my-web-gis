import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function renameFolder(page: Page, current: string, name: string) {
  await page.getByRole('button', { name: `组操作：${current}`, exact: true }).click()
  await page.getByRole('menuitem', { name: '重命名文件夹', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '重命名文件夹', exact: true })
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: '应用', exact: true }).click()
}

async function roundTrip(page: Page, info: TestInfo) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = info.outputPath('nested.webgis.json')
  await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  const current = await page.evaluate(async () => {
    const { useProjectStore, getProjectContentVersion } = await import('/src/stores/project.store.ts')
    const { createSnapshotFromState } = await import('/src/services/project-io.ts')
    const state = useProjectStore.getState()
    return { dirty: state.dirty, version: getProjectContentVersion(), snapshot: createSnapshotFromState(state.project, state.featuresByDataset) }
  })
  await info.attach('saved-version-comparison', { body: JSON.stringify({ saved, current }), contentType: 'application/json' })
  expect(current.dirty).toBe(false)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await chooser).setFiles(path)
  return saved
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
})

test('2D nested folders retain datasets, order and inherited locks through file IO and undo', async ({ page }, info) => {
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'nested.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'sample', properties: { value: 42 }, geometry: { type: 'Point', coordinates: [116.4, 39.9] } }] })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('button', { name: '新建组', exact: true }).click()
  await renameFolder(page, '新建组', 'Outer')
  await page.getByRole('button', { name: '组操作：Outer', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建子文件夹', exact: true }).click()
  await renameFolder(page, '新建文件夹', 'Inner')
  const inner = page.locator('.layer-group-header').filter({ hasText: 'Inner' })
  await page.locator('.layer-item').filter({ hasText: 'nested' }).dragTo(inner)
  const state = await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    return useProjectStore.getState().getSnapshot()
  })
  const outer = state.project.groups.find(group => group.name === 'Outer')!, child = state.project.groups.find(group => group.name === 'Inner')!
  expect(child.parentId).toBe(outer.id)
  expect(child.layerIds).toEqual([state.project.layers[0].id])
  await page.getByRole('button', { name: '组操作：Outer', exact: true }).click()
  await page.getByRole('menuitem', { name: '锁定文件夹', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始编辑', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByRole('button', { name: '开始编辑', exact: true })).toBeEnabled()
  const saved = await roundTrip(page, info)
  await expect(page.locator('.layer-group-name').filter({ hasText: 'Inner' })).toBeVisible()
  expect(saved.project.groups.find((group: { name: string }) => group.name === 'Inner').parentId).toBe(outer.id)
  await page.getByRole('button', { name: '组操作：Outer', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除组', exact: true }).click()
  await page.getByRole('button', { name: '移除组，保留图层', exact: true }).click()
  await expect(page.locator('.layer-group-name').filter({ hasText: 'Outer' })).toHaveCount(0)
  await expect(page.locator('.layer-name-button').filter({ hasText: 'nested' })).toBeVisible()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.layer-group-name').filter({ hasText: 'Outer' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('nested-2d.png') })
})

test('3D nested folder creation, cycle rejection and saved parent IDs use real scene commands', async ({ page }, info) => {
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.city-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  for (const name of ['Outer', 'Inner']) {
    await page.getByRole('button', { name: '新建场景分组', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建场景分组', exact: true })
    await dialog.getByRole('textbox').fill(name)
    await dialog.getByRole('button', { name: '创建分组', exact: true }).click()
  }
  const outerButton = page.locator('.city-scene-group__name').filter({ hasText: 'Outer' })
  const innerHeader = page.locator('.city-scene-group__header').filter({ hasText: 'Inner' })
  await outerButton.dragTo(innerHeader)
  await expect(page.locator('.city-footer__state')).toContainText('后代')
  const saved = await roundTrip(page, info)
  const outer = saved.project.city.groups.find((group: { name: string }) => group.name === 'Outer')
  expect(saved.project.city.groups.find((group: { name: string }) => group.name === 'Inner').parentId).toBe(outer.id)
  await expect(page.locator('.city-scene-group__name').filter({ hasText: 'Inner' })).toBeVisible()
  await page.screenshot({ path: info.outputPath('nested-3d.png') })
})
