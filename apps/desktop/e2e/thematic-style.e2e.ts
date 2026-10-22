import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

async function importPoints(page: Page) {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../../../examples/phase-1/points.geojson', import.meta.url)))
  await page.getByRole('dialog', { name: '添加数据', exact: true }).getByRole('button', { name: '确认导入', exact: true }).click()
  await page.locator('.layer-name-button').first().click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '样式', exact: true }).click()
}

async function state(page: Page) {
  return page.evaluate(async () => {
    const loaded = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(loaded('/src/stores/project.store.ts')) as typeof import('../src/stores/project.store')
    const project = useProjectStore.getState().project
    const { getMapRuntime } = await import(loaded('/src/features/map/map-runtime-host.ts')) as typeof import('../src/features/map/map-runtime-host')
    const layer = project.layers.find(item => item.id === useProjectStore.getState().selectedLayerId)!
    const binding = project.cartography.bindings.find(item => item.gisLayerId === layer.id)!
    const runtime = getMapRuntime(), native = runtime?.registry.getVector(layer.id)
    const samples = native?.getSource()?.getFeatures().map(feature => {
      const result = native.getStyleFunction()?.(feature, runtime!.getMap().getView().getResolution()!)
      const styles = Array.isArray(result) ? result : result ? [result] : []
      return { name: feature.get('name'), color: styles.find(style => style.getImage())?.getImage()?.getFill()?.getColor(),
        text: styles.find(style => style.getText())?.getText()?.getText() }
    }) ?? []
    return { layer: structuredClone(layer), samples, fragment: structuredClone({ binding,
      styleLayers: project.cartography.styleLayers.filter(item => binding.styleLayerIds.includes(item.id)) }) }
  })
}

test('categorized and graduated styles and labels update the native map, legend and history immediately', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await importPoints(page)
  const panel = page.locator('.style-panel')
  await page.getByText('图例预览', { exact: true }).click()
  const legend = page.locator('.legend-panel')
  const initial = await state(page)

  await panel.getByLabel('渲染方式').click()
  await page.locator('.ant-select-dropdown:visible').getByText('分类渲染', { exact: true }).click()
  await panel.getByLabel('点半径', { exact: true }).first().fill('8')
  await panel.getByLabel('点半径', { exact: true }).first().blur()
  await expect.poll(async () => (await state(page)).layer.style.fallback?.radius).toBe(8)
  await panel.getByLabel('分类字段').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^name$/ }).click()
  await panel.getByRole('button', { name: '重新分类', exact: true }).click()
  await expect.poll(async () => (await state(page)).layer.style.mode).toBe('categorized')
  await expect(legend).toContainText('北京市中心')
  await expect.poll(async () => (await state(page)).fragment.styleLayers).not.toEqual(initial.fragment.styleLayers)
  await expect.poll(async () => new Set((await state(page)).samples.map(sample => String(sample.color))).size).toBe(3)

  const label = panel.getByLabel('北京市中心 图例名称', { exact: true })
  await label.fill('北京地标')
  await expect.poll(async () => (await state(page)).layer.style.categories.find(category => category.value === '北京市中心')?.label).toBe('北京地标')
  await expect(legend).toContainText('北京地标')
  await label.blur()
  await page.getByRole('tab', { name: '标注', exact: true }).click()
  await page.getByLabel('启用标注').click()
  const enabledLabel = (await state(page)).layer.style.label
  await page.getByLabel('标注字段').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^name$/ }).click()
  await expect.poll(async () => (await state(page)).layer.style.label?.field).toBe('name')
  await expect.poll(async () => (await state(page)).fragment.styleLayers.some(layer => layer.type === 'symbol')).toBe(true)
  await expect.poll(async () => (await state(page)).samples.find(sample => sample.name === '北京市中心')?.text).toBe('北京市中心')

  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).layer.style.label).toEqual(enabledLabel)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await state(page)).layer.style.label?.field).toBe('name')
  await page.getByRole('tab', { name: '样式', exact: true }).click()
  await panel.getByLabel('渲染方式').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^分级渲染$/ }).click()
  await panel.getByLabel('分级字段').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^value$/ }).click()
  await panel.getByLabel('分段数').fill('3')
  await panel.getByRole('button', { name: '重新分级', exact: true }).click()
  await expect.poll(async () => (await state(page)).layer.style.breaks?.length).toBe(3)
  await expect.poll(async () => new Set((await state(page)).samples.map(sample => String(sample.color))).size).toBe(3)
  await expect(legend).not.toContainText('北京地标')
  const graduated = (await state(page)).fragment
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).fragment).not.toEqual(graduated)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await state(page)).fragment).toEqual(graduated)
  expect(errors).toEqual([])
})
