import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

async function addPoints(page: Page) {
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles(fileURLToPath(new URL('../../../examples/phase-1/points.geojson', import.meta.url)))
  await page.getByRole('dialog', { name: '添加数据', exact: true }).getByRole('button', { name: '确认导入', exact: true }).click()
}

async function openMap(page: Page) {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
}

async function cartographyState(page: Page) {
  return page.evaluate(async () => {
    const loaded = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(loaded('/src/stores/project.store.ts')) as typeof import('../src/stores/project.store')
    const { getMapRuntime } = await import(loaded('/src/features/map/map-runtime-host.ts')) as typeof import('../src/features/map/map-runtime-host')
    const { useWorkbenchStore } = await import(loaded('/src/stores/workbench.store.ts')) as typeof import('../src/stores/workbench.store')
    const state = useProjectStore.getState()
    const layer = state.project.layers.find(item => item.id === (useWorkbenchStore.getState().inspectorLayerId ?? state.selectedLayerId))!
    const binding = state.project.cartography.bindings.find(item => item.gisLayerId === layer.id)!
    const runtimeLayer = getMapRuntime()?.registry.getVector(layer.id)
    const feature = runtimeLayer?.getSource()?.getFeatures()[0]
    const result = feature ? runtimeLayer?.getStyleFunction()?.(feature, getMapRuntime()!.getMap().getView().getResolution()!) : undefined
    const style = Array.isArray(result) ? result[0] : result
    const radius = (style?.getImage() as unknown as { getRadius(): number } | undefined)?.getRadius() ?? null
    return {
      layer: structuredClone(layer),
      fragment: structuredClone(state.project.cartography.styleLayers.filter(item => binding.styleLayerIds.includes(item.id))),
      radius,
      selectedLayerId: layer.id,
      layerIds: state.project.layers.map(item => item.id),
      layerCount: state.project.layers.length,
      dirty: state.dirty
    }
  })
}

test('point radius edits coalesce by gesture, undo separately and save the focused value', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await openMap(page)
  await addPoints(page)
  await page.locator('.layer-name-button').first().click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '样式', exact: true }).click()
  const input = page.locator('.style-panel .cartography-control-grid .ant-input-number-input').first()
  await expect.poll(async () => (await cartographyState(page)).radius).not.toBeNull()
  const initial = await cartographyState(page)
  const initialRadius = initial.radius
  expect(initialRadius).not.toBeNull()

  await input.focus()
  for (let value = 18; value <= 37; value += 1) await input.fill(String(value))
  await expect.poll(async () => (await cartographyState(page)).radius).toBe(37)
  await expect.poll(async () => (await cartographyState(page)).fragment[0]?.paint?.['circle-radius']).toBe(37)
  await input.blur()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await cartographyState(page)).radius).toBe(initialRadius)

  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await cartographyState(page)).radius).toBe(37)
  await input.focus()
  await input.fill('41')
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const savedPath = info.outputPath('focused-cartography.webgis.json')
  await (await download).saveAs(savedPath)
  const saved = JSON.parse(readFileSync(savedPath, 'utf8'))
  const savedLayerId = (await cartographyState(page)).selectedLayerId
  const savedBinding = saved.project.cartography.bindings.find((binding: { gisLayerId: string }) => binding.gisLayerId === savedLayerId)
  const savedFragment = saved.project.cartography.styleLayers.filter((style: { id: string }) => savedBinding.styleLayerIds.includes(style.id))
  expect(savedFragment[0].paint['circle-radius']).toBe(41)

  await input.fill('47')
  await expect.poll(async () => (await cartographyState(page)).radius).toBe(47)
  await input.blur()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await cartographyState(page)).radius).toBe(41)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await cartographyState(page)).radius).toBe(37)
  expect(errors).toEqual([])
})

test('switching layers preserves immediate edits without a draft dialog', async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await openMap(page)
  await addPoints(page)
  await addPoints(page)
  const rows = page.locator('.layer-name-button')
  await expect(rows).toHaveCount(2)
  await rows.nth(0).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '样式', exact: true }).click()
  const firstInput = page.locator('.style-panel .cartography-control-grid .ant-input-number-input').first()
  await firstInput.fill('23')
  await firstInput.blur()
  const firstLayer = await cartographyState(page)
  const names = await page.evaluate(async () => {
    const { useProjectStore } = await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/stores/project.store.ts') ?? '/src/stores/project.store.ts')
    return useProjectStore.getState().project.layers.map(layer => ({ id: layer.id, name: layer.name }))
  })
  await page.getByLabel('配置图层').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').nth(names.findIndex(layer => layer.id !== firstLayer.selectedLayerId)).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(async () => (await cartographyState(page)).selectedLayerId).not.toBe(firstLayer.selectedLayerId)
  await page.getByLabel('配置图层').click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').nth(names.findIndex(layer => layer.id === firstLayer.selectedLayerId)).click()
  await expect.poll(async () => (await cartographyState(page)).radius).toBe(23)
})

test('advanced expressions remain intact while safe sibling parameters stay editable', async ({ page }) => {
  const scene = {
    version: 3,
    id: 'advanced-style-readonly',
    title: 'Advanced style',
    activeView: 'map',
    views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 4 } },
    resources: { points: { type: 'geojson', data: { type: 'FeatureCollection', features: [{
      type: 'Feature', id: 'point-0', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 2 },
    }] } } },
    nodes: [{ id: 'points-layer', name: 'Points', type: 'vector', resource: 'points', visible: true, opacity: 1,
      filter: [], style: { mode: 'single', symbol: { type: 'circle', radius: 4, fill: { r: 0, g: 0, b: 255, a: 1 } } } }],
    extensions: { 'org.my-web-gis.cartography': { version: 1, required: true, data: {
      specVersion: 8,
      bindings: [{ gisLayerId: 'points-layer', datasetId: 'points', styleSourceId: 'source-points', styleLayerIds: ['advanced-circle'] }],
      styleLayers: [{ id: 'advanced-circle', source: 'source-points', type: 'circle', paint: {
        'circle-color': '#336699', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 5, 16, 15],
      } }],
    } } },
  }
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await openMap(page)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: 'advanced.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) })
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.locator('.layer-name-button').click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '样式', exact: true }).click()
  const panel = page.locator('.style-panel')
  await expect(panel.getByRole('button', { name: '半径表达式', exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Points符号预览', exact: true }).locator('..')).not.toHaveAttribute('title')
  const before = await page.evaluate(async () => {
    const loaded = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(loaded('/src/stores/project.store.ts')) as typeof import('../src/stores/project.store')
    return structuredClone(useProjectStore.getState().project.cartography)
  })
  await expect(panel.getByLabel('渲染方式')).toHaveCount(0)
  await panel.getByLabel('标准描边宽度', { exact: true }).fill('3')
  await panel.getByLabel('标准描边宽度', { exact: true }).blur()
  const edited = await page.evaluate(async () => (await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/stores/project.store.ts') ?? '/src/stores/project.store.ts')).useProjectStore.getState().project.cartography)
  expect(edited!.styleLayers[0]!.paint!['circle-radius']).toEqual(before!.styleLayers[0]!.paint!['circle-radius'])
  expect(edited!.styleLayers[0]!.paint!['circle-stroke-width']).toBe(3)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('tab', { name: '标注', exact: true }).click()
  await expect(page.getByText('当前没有文字样式，可在专业标注编辑中添加。', { exact: true })).toBeVisible()
  const after = await page.evaluate(async () => {
    const loaded = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(loaded('/src/stores/project.store.ts')) as typeof import('../src/stores/project.store')
    return structuredClone(useProjectStore.getState().project.cartography)
  })
  expect(after).toEqual(before)
})
