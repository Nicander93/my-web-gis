import { test, expect, type Page } from '@playwright/test'
test.use({ actionTimeout: 15_000, screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })
async function snapshot(page: Page) { return page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().getSnapshot()) }
async function upload(page: Page, name: string) {
  await page.locator('input[type=file]').setInputFiles({ name: `${name}.geojson`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', features: [{ type: 'Feature', id: 'source-001', properties: { code: '0007' }, geometry: { type: 'Point', coordinates: [116, 39, 12] } }]
  })) })
}
test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
})

test('real worker parses one file, preserves data and commits one undoable import', async ({ page }) => {
  const before = await snapshot(page)
  await upload(page, 'single')
  const dialog = page.getByRole('dialog', { name: '添加数据', exact: true })
  await expect(dialog).toContainText('single')
  expect(await snapshot(page)).toEqual(before)
  expect(await page.locator('input[type=file]').getAttribute('multiple')).toBeNull()
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click()
  const imported = await snapshot(page)
  expect(imported.project.layers.map(layer => layer.name)).toEqual(['single'])
  expect(Object.values(imported.featuresByDataset).flat()[0]).toMatchObject({ properties: { code: '0007' }, geometry: { coordinates: [expect.closeTo(116, 10), expect.closeTo(39, 10), 12] } })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(await snapshot(page)).toEqual(imported)
})

test('cancel and project replacement terminate pending workers without importing late results', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/services/import.worker.ts*', async route => { await gate; await route.continue().catch(() => {}) })
  const before = await snapshot(page)
  await upload(page, 'cancelled')
  await page.getByRole('button', { name: '取消读取', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await upload(page, 'old-project')
  await expect(page.getByRole('button', { name: '取消读取', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const store = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    const next = store.getSnapshot(); next.project.id = 'replacement'; store.loadSnapshot(next)
  })
  const replacement = await snapshot(page)
  release()
  await expect(page.getByRole('dialog')).toContainText('读取期间工程已改变')
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toHaveCount(0)
  expect(await snapshot(page)).toEqual(replacement)
})

test('large GeoJSON and CSV preview/parse use real workers while the main thread remains responsive', async ({ page }) => {
  test.setTimeout(120_000)
  const result = await page.evaluate(async () => {
    const { importGeoJson, importCsvFile, inspectDxfLayers } = await import('/src/services/import.ts')
    const { runImportTask } = await import('/src/services/import-worker.ts')
    let ticks = 0
    const timer = setInterval(() => ticks++, 0)
    try {
      const geojson = await importGeoJson(new File([JSON.stringify({ type: 'FeatureCollection', features: Array.from({ length: 30_000 }, (_, i) => ({ type: 'Feature', id: i, properties: { code: '0007' }, geometry: { type: 'Point', coordinates: [116 + i / 100000, 39] } })) })], 'large.geojson'))
      const content = 'code,x,y\n0007,116,39\n0008,117,40'
      const preview = await runImportTask<{ totalRows: number; validRows: number }>({ kind: 'csv-preview', content, options: { xField: 'x', yField: 'y', crs: { code: 'EPSG:4326' } } })
      const csv = await importCsvFile(new File([content], 'points.csv'), { xField: 'x', yField: 'y', crs: { code: 'EPSG:4326' } })
      const dxf = await inspectDxfLayers(new File(['0\nSECTION\n2\nENTITIES\n0\nPOINT\n8\npoints\n10\n116\n20\n39\n0\nENDSEC\n0\nEOF\n'], 'point.dxf'))
      return { ticks, errors: geojson.errors, count: geojson.layers[0]?.features.length, csv: csv.layers[0]?.features.map(feature => feature.properties.code), preview, dxf }
    } finally { clearInterval(timer) }
  })
  expect(result.errors).toEqual([])
  expect(result.count).toBe(30_000)
  expect(result.ticks).toBeGreaterThan(1)
  expect(result.csv).toEqual(['0007', '0008'])
  expect(result.preview).toMatchObject({ totalRows: 2, validRows: 2 })
  expect(result.dxf).toContain('points')
})
