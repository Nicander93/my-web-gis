import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { RecoveryDraft } from '../src/services/project-recovery'

async function drafts(page: Page): Promise<RecoveryDraft[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('desktop-webgis-recovery', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const read = db.transaction('projects', 'readonly').objectStore('projects').getAll()
      read.onsuccess = () => { db.close(); resolve(read.result.map((text) => JSON.parse(text))) }
      read.onerror = () => { db.close(); reject(read.error) }
    }
  }))
}
async function waitForDraft(page: Page) {
  await expect.poll(async () => (await drafts(page)).length, { timeout: 15_000 }).toBe(1)
  return (await drafts(page))[0]
}
async function importPoints(page: Page) {
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'recovery.geojson', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'point-1',
      properties: { code: '001', value: 2 }, geometry: { type: 'Point', coordinates: [116.391, 39.907] } }] })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
}

test('applied table edits survive abrupt page closure, restore as dirty and clear only after successful save', async ({ page, context }, info) => {
  await context.route('**/*tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await importPoints(page)
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  const panel = page.locator('.attribute-table-tab-panel:visible')
  await panel.getByRole('button', { name: '字段计算', exact: true }).click()
  await panel.getByLabel('计算字段名').fill('value')
  await panel.getByLabel('字段计算表达式').fill('field("value") + 40')
  await panel.getByRole('button', { name: '应用计算', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('1 条')
  await expect.poll(async () => Object.values((await drafts(page))[0]?.snapshot.featuresByDataset ?? {}).flat()[0]?.properties.value,
    { timeout: 15_000 }).toBe(42)
  const draft = await waitForDraft(page)
  const datasetId = draft.snapshot.project.datasets[0].id
  expect(draft.snapshot.featuresByDataset[datasetId][0].properties).toEqual({ code: '001', value: 42 })
  await page.close({ runBeforeUnload: false })
  const reopened = await context.newPage(); await reopened.goto('/')
  const dialog = reopened.getByRole('dialog', { name: '发现恢复草稿', exact: true })
  await expect(dialog).toBeVisible()
  await reopened.screenshot({ path: info.outputPath('recovery-startup.png') })
  await dialog.getByRole('button', { name: '恢复草稿', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(reopened.locator('.project-dirty')).toContainText('未保存')
  await reopened.locator('.layer-name-button').filter({ hasText: 'recovery' }).click()
  await reopened.getByRole('button', { name: '属性表', exact: true }).click()
  await expect(reopened.locator('.attribute-table-tab-panel:visible tbody')).toContainText('42')
  const download = reopened.waitForEvent('download')
  await reopened.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = info.outputPath('restored.webgis.json'); await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  expect(saved.project.id).toBe(draft.projectId)
  expect(saved.project.layers).toEqual(draft.snapshot.project.layers)
  expect(saved.project.datasets).toEqual(draft.snapshot.project.datasets)
  expect(saved.featuresByDataset).toEqual(draft.snapshot.featuresByDataset)
  await expect.poll(() => drafts(reopened)).toEqual([])
  await reopened.close({ runBeforeUnload: false })
  const again = await context.newPage(); await again.goto('/')
  await expect(again.getByRole('button', { name: /^二维地图/ })).toBeVisible()
  await expect(again.getByRole('dialog', { name: '发现恢复草稿' })).toHaveCount(0)
})

test('damaged cache disables restore and explicit discard leaves another project intact', async ({ page, context }) => {
  await context.route('**/*tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/'); await page.getByRole('button', { name: /^二维地图/ }).click()
  await importPoints(page)
  const draft = await waitForDraft(page)
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('desktop-webgis-recovery', 1)
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result, transaction = db.transaction('projects', 'readwrite')
      transaction.objectStore('projects').put('{broken', '636f7272757074')
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onabort = () => { db.close(); reject(transaction.error) }
    }
  }))
  await page.close({ runBeforeUnload: false })
  const reopened = await context.newPage(); await reopened.goto('/')
  const dialog = reopened.getByRole('dialog', { name: '发现恢复草稿', exact: true })
  const corrupt = dialog.getByRole('region', { name: '无法读取的恢复草稿', exact: true })
  await expect(corrupt.getByRole('button', { name: '恢复草稿', exact: true })).toBeDisabled()
  await corrupt.getByRole('button', { name: '舍弃草稿', exact: true }).click()
  expect((await drafts(reopened))[0].projectId).toBe(draft.projectId)
  await expect(dialog.getByRole('region', { name: draft.snapshot.project.name, exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '舍弃草稿', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await drafts(reopened)).toEqual([])
})

test('3D folder IDs and applied scene settings recover through the real Cesium workspace', async ({ page, context }, info) => {
  test.setTimeout(70_000)
  await context.route('**/*tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/'); await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.city-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await page.getByRole('button', { name: '新建场景分组', exact: true }).click()
  const group = page.getByRole('dialog', { name: '新建场景分组', exact: true })
  await group.getByRole('textbox').fill('Recovered group')
  await group.getByRole('button', { name: '创建分组', exact: true }).click()
  await page.getByRole('tablist', { name: '三维工作任务', exact: true }).getByRole('tab', { name: '场景', exact: true }).click()
  await page.getByRole('button', { name: '光照与时间', exact: true }).click()
  const sunlight = page.getByRole('checkbox', { name: '太阳光照', exact: true })
  await sunlight.setChecked(!await sunlight.isChecked())
  const checked = await sunlight.isChecked()
  await expect.poll(async () => (await drafts(page))[0]?.snapshot.project.city?.lighting?.sunlight,
    { timeout: 15_000 }).toBe(checked)
  const draft = await waitForDraft(page)
  await page.close({ runBeforeUnload: false })
  const reopened = await context.newPage(); await reopened.goto('/')
  await reopened.getByRole('dialog', { name: '发现恢复草稿', exact: true }).getByRole('button', { name: '恢复草稿', exact: true }).click()
  await expect(reopened.locator('.city-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await expect(reopened.locator('.city-scene-group__name').filter({ hasText: 'Recovered group' })).toBeVisible()
  await reopened.getByRole('tablist', { name: '三维工作任务', exact: true }).getByRole('tab', { name: '场景', exact: true }).click()
  await reopened.getByRole('button', { name: '光照与时间', exact: true }).click()
  await expect(reopened.getByRole('checkbox', { name: '太阳光照', exact: true })).toBeChecked({ checked })
  const download = reopened.waitForEvent('download')
  await reopened.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = info.outputPath('recovered-city.webgis.json'); await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  expect(saved.project.city.groups).toEqual(draft.snapshot.project.city!.groups)
  expect(saved.project.city.lighting).toEqual(draft.snapshot.project.city!.lighting)
  expect(saved.project.city.effects).toEqual(draft.snapshot.project.city!.effects)
  expect(saved.project.city.nodes).toEqual(draft.snapshot.project.city!.nodes)
  expect(saved.project.city.assets).toEqual(draft.snapshot.project.city!.assets)
  await expect.poll(() => drafts(reopened)).toEqual([])
})
