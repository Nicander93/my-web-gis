import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'

test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
})

test('projected Chinese shapefile ZIP imports only the two chosen source layers', async ({ page }, info) => {
  const fixture = fileURLToPath(new URL('../../../examples/phase-1/projected-chinese-multi.zip', import.meta.url))
  await page.locator('input[type=file]').setInputFiles(fixture)
  const dialog = page.getByRole('dialog', { name: '添加数据', exact: true })
  await expect(dialog.getByRole('checkbox')).toHaveCount(3)
  await dialog.getByRole('button', { name: '取消全选', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '导入 0 个图层', exact: true })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: 'stations', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'sites', exact: true }).check()
  await dialog.getByRole('button', { name: '导入 2 个图层', exact: true }).click()
  await expect(dialog).not.toContainText('缺少 .prj')
  await dialog.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toHaveCount(2)
  await expect(page.locator('.layer-name-button')).not.toContainText(['excluded'])
  const state = await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const state = useProjectStore.getState()
    return state.project.layers.map(layer => ({ name: layer.name, features: state.featuresByDataset[layer.datasetId] }))
  })
  expect(state.map(layer => layer.name).sort()).toEqual(['sites', 'stations'])
  expect(state.find(layer => layer.name === 'stations')!.features).toHaveLength(2)
  const first = state.find(layer => layer.name === 'stations')!.features[0]
  expect(first.properties).toMatchObject({ 编号: '01', 名称: '北京站' })
  expect(first.geometry).toMatchObject({ coordinates: [expect.closeTo(116.4, 6), expect.closeTo(39.9, 6)] })
  expect(first.metadata?.sourceCrs).toBe('EPSG:3857')
  await page.locator('.layer-name-button').filter({ hasText: /^stations$/ }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await expect(page.locator('.table-scroll')).toContainText('名称')
  await expect(page.locator('.table-scroll')).toContainText('北京站')
  await page.getByRole('button', { name: '全图', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const runtime = getMapRuntime()!, map = runtime.getMap(), size = map.getSize()!
    return !map.getView().getAnimating() && runtime.registry.entries().filter(([, layer]) => 'getSource' in layer).every(([, layer]) => {
      const source = layer.getSource()
      if (!source || !('getFeatures' in source)) return true
      return source.getFeatures().every(feature => {
        const geometry = feature.getGeometry()!
        const pixel = map.getPixelFromCoordinate(geometry.getExtent().slice(0, 2))
        return pixel.every(Number.isFinite) && pixel[0] >= 0 && pixel[0] <= size[0] && pixel[1] >= 0 && pixel[1] <= size[1]
      })
    })
  })).toBe(true)
  await page.screenshot({ path: info.outputPath('shapefile-chinese-projected.png') })
})

test('CSV preview identifies invalid coordinates and imports only valid records', async ({ page }, info) => {
  const fixture = fileURLToPath(new URL('../../../examples/phase-1/coordinates-with-errors.csv', import.meta.url))
  await page.locator('input[type=file]').setInputFiles(fixture)
  const config = page.getByRole('dialog', { name: 'CSV 坐标', exact: true })
  await expect(config.getByLabel('经度 (X)', { exact: true })).toHaveValue('longitude')
  await expect(config.getByLabel('纬度 (Y)', { exact: true })).toHaveValue('latitude')
  await expect(config.locator('.csv-record-count')).toHaveText('全部 6 · 可导入 4 · 错误 2')
  await expect(config.locator('.csv-error-list')).toContainText('纬度超出范围: 91')
  await expect(config.locator('.csv-error-list')).toContainText('非数字或非有限值')
  await config.getByLabel('纬度 (Y)', { exact: true }).selectOption('longitude')
  await expect(config.getByRole('button', { name: /^确认/ })).toBeDisabled()
  await config.getByLabel('纬度 (Y)', { exact: true }).selectOption('latitude')
  await config.getByRole('button', { name: '确认 (4 个有效记录)', exact: true }).click()
  const review = page.getByRole('dialog', { name: '添加数据', exact: true })
  await expect(review).toContainText('跳过 2 行无效记录')
  await review.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toHaveCount(1)
  const features = await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const state = useProjectStore.getState()
    return state.featuresByDataset[state.project.layers[0].datasetId]
  })
  expect(features.map(feature => feature.properties.id)).toEqual(['001', '002', '004', '006'])
  expect(String(features[1].properties.notes).replaceAll('\r\n', '\n')).toBe('包含换行\n的备注信息')
  expect(features[2].properties.notes).toBe('正常记录,有引号')
  expect(features[0].geometry).toMatchObject({ coordinates: [116.3975, 39.9085] })
  await page.locator('.layer-name-button').click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const table = page.locator('.table-scroll')
  await expect(table.locator('tbody tr')).toHaveCount(4)
  await expect(table).toContainText('北京站点')
  await expect(table).toContainText('006')
  await expect(table).not.toContainText('纬度错误')
  await expect(table).not.toContainText('经度无效')
  await page.screenshot({ path: info.outputPath('csv-valid-records.png') })
})
