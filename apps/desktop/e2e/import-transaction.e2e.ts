import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function snapshot(page: Page) {
  return page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().getSnapshot())
}

async function delayedFirstRead(page: Page) {
  await page.addInitScript(() => {
    const original = File.prototype.text
    let first = true
    File.prototype.text = function () {
      const reading = original.call(this)
      if (!first) return reading
      first = false
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      ;(window as typeof window & { releaseImportRead?: () => Promise<void> }).releaseImportRead = async () => {
        release(); await reading
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
      return Promise.all([reading, gate]).then(([text]) => text)
    }
  })
}

async function releaseRead(page: Page) {
  await page.evaluate(async () => {
    await (window as typeof window & { releaseImportRead?: () => Promise<void> }).releaseImportRead?.()
  })
}

async function upload(page: Page, name: string, value: number) {
  await page.locator('input[type=file]').setInputFiles({ name: `${name}.geojson`, mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: name,
      properties: { value, code: '0007' }, geometry: { type: 'Point', coordinates: [116, 39] } }] })) })
}

test.beforeEach(async ({ page }) => {
  await delayedFirstRead(page)
  await page.route('**/*tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
})

test('canceling a real file read rejects its late result and the next confirmed import uses one history step', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message))
  const before = await snapshot(page)
  await upload(page, 'old', 1)
  await page.getByRole('button', { name: '取消读取', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await upload(page, 'fresh', 2)
  const dialog = page.getByRole('dialog', { name: '添加数据', exact: true })
  await expect(dialog).toContainText('fresh')
  await releaseRead(page)
  await expect(dialog).toContainText('fresh')
  await expect(dialog).not.toContainText('old')
  await page.screenshot({ path: info.outputPath('import-transaction-preview.png') })
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click()
  const imported = await snapshot(page)
  expect(imported.project.layers.map((layer) => layer.name)).toEqual(['fresh'])
  const dataset = imported.project.datasets[0].id
  expect(imported.featuresByDataset[dataset][0].properties).toEqual({ value: 2, code: '0007' })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(await snapshot(page)).toEqual(imported)
  expect(errors).toEqual([])
})

test('a project replaced during file reading does not receive the previous project import', async ({ page }) => {
  await upload(page, 'previous-project-data', 1)
  await expect(page.getByRole('button', { name: '取消读取', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const replacement = useProjectStore.getState().getSnapshot()
    replacement.project.id = 'replacement-project'; replacement.project.name = 'Replacement'
    useProjectStore.getState().loadSnapshot(replacement)
  })
  const replacement = await snapshot(page)
  await releaseRead(page)
  const dialog = page.getByRole('dialog', { name: '添加数据', exact: true })
  await expect(dialog).toContainText('读取期间工程已改变，结果未导入')
  await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0)
  expect(await snapshot(page)).toEqual(replacement)
  await dialog.getByRole('button', { name: '关闭添加数据', exact: true }).click()
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
})

test('multiple GeoJSON files are previewed, committed and undone as one batch with stable IDs', async ({ page }, info) => {
  const before = await snapshot(page)
  await page.locator('input[type=file]').setInputFiles(['points', 'areas'].map((name, index) => ({
    name: `${name}.geojson`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', id: `source-${index}`, properties: { name, code: '001' }, geometry: index
        ? { type: 'Polygon', coordinates: [[[116, 39], [117, 39], [117, 40], [116, 40], [116, 39]]] }
        : { type: 'Point', coordinates: [116.5, 39.5] }
    }] }))
  })))
  await releaseRead(page)
  const dialog = page.getByRole('dialog', { name: '添加数据', exact: true })
  await expect(dialog).toContainText('points')
  await expect(dialog).toContainText('areas')
  await expect(page.locator('.layer-name-button')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('multi-geojson-preview.png') })
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click()
  const imported = await snapshot(page)
  expect(imported.project.layers.map((layer) => layer.name)).toEqual(['points', 'areas'])
  expect(Object.values(imported.featuresByDataset).flat().map((feature) => feature.geometry.type)).toEqual(['Point', 'Polygon'])
  await expect.poll(() => page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    return useProjectStore.getState().project.layers.map((layer) => getMapRuntime()?.registry.getVector(layer.id)?.getSource()?.getFeatures().length ?? 0)
  })).toEqual([1, 1])
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(await snapshot(page)).toEqual(imported)
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await expect(page.locator('.attribute-table-tab-panel:visible').locator('tbody')).toContainText('001')
  const liveMapState = await page.evaluate(async () => (await import('/src/features/map/map-runtime-host.ts')).getLiveMapState())
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = info.outputPath('multi-import.webgis.json')
  await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  // Save captures the live viewport, including the engine's initial zoom constraint.
  expect(saved).toEqual({ ...imported, project: { ...imported.project, mapState: liveMapState } })
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await chooser).setFiles(path)
  expect(await snapshot(page)).toEqual(saved)
})

test('a failed file rejects the complete GeoJSON batch without importing the valid file', async ({ page }) => {
  const before = await snapshot(page)
  await page.locator('input[type=file]').setInputFiles([
    { name: 'valid.geojson', mimeType: 'application/json', buffer: Buffer.from('{"type":"Point","coordinates":[116,39]}') },
    { name: 'broken.geojson', mimeType: 'application/json', buffer: Buffer.from('broken GeoJSON') }
  ])
  await releaseRead(page)
  const dialog = page.getByRole('dialog', { name: '添加数据', exact: true })
  await expect(dialog).toContainText('broken.geojson')
  await expect(dialog.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0)
  expect(await snapshot(page)).toEqual(before)
  await dialog.getByRole('button', { name: '关闭添加数据', exact: true }).click()
  await expect(page.getByRole('button', { name: '撤销', exact: true })).toBeDisabled()
})
