import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })

const ring = [[116,39],[116.01,39],[116.01,39.01],[116,39.01],[116,39]]
const hole = [[116.002,39.002],[116.002,39.004],[116.004,39.004],[116.004,39.002],[116.002,39.002]]
async function snapshot(page: Page) { return page.evaluate(async () => (await import('/src/stores/project.store.ts')).useProjectStore.getState().getSnapshot()) }
async function pixel(page: Page, midpoint = false) {
  return page.evaluate(async midpoint => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const runtime = getMapRuntime()!, layer = useProjectStore.getState().project.layers[0]
    const feature = runtime.registry.getVector(layer.id)!.getSource()!.getFeatures().find(feature => feature.get('name') === 'A')!
    const geometry = feature.getGeometry() as unknown as { getCoordinates(): number[][][] }
    const ring = geometry.getCoordinates()[0], coordinate = midpoint ? [(ring[1][0] + ring[2][0]) / 2, (ring[1][1] + ring[2][1]) / 2] : ring[1]
    return runtime.getMap().getPixelFromCoordinate(coordinate)
  }, midpoint)
}
async function pointer(page: Page, point: number[]) {
  const bounds = (await page.locator('.ol-viewport').boundingBox())!
  return { x: bounds.x + point[0], y: bounds.y + point[1] }
}
async function drag(page: Page, point: number[], cancel = false) {
  const position = await pointer(page, point)
  await page.mouse.move(position.x, position.y)
  await page.mouse.down()
  await page.mouse.move(position.x + 28, position.y - 18, { steps: 8 })
  if (cancel) {
    await page.keyboard.press('Escape')
    await page.mouse.move(position.x + 40, position.y - 24, { steps: 3 })
  }
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'vertices.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'a', properties: { name: 'A', code: '001' }, geometry: { type: 'Polygon', coordinates: [ring, hole] } },
    { type: 'Feature', id: 'b', properties: { name: 'B' }, geometry: { type: 'MultiPolygon', coordinates: [[[[116.01,39],[116.02,39],[116.02,39.01],[116.01,39.01],[116.01,39]]], [[[116.022,39],[116.024,39],[116.024,39.002],[116.022,39.002],[116.022,39]]]] } },
    { type: 'Feature', id: 'c', properties: { name: 'Unselected' }, geometry: { type: 'LineString', coordinates: [[116.01,39],[116.015,38.998]] } }
  ] })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '图层面板', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  // Seed the same stable-ID selection produced by the table before entering Modify.
  await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const store = useProjectStore.getState(), layer = store.project.layers[0]
    store.setSelection({ layerId: layer.id, featureIds: store.featuresByDataset[layer.datasetId].filter(feature => feature.properties.name !== 'Unselected').map(feature => feature.id) })
  })
  await page.getByRole('button', { name: '修改几何', exact: true }).click()
  await expect.poll(() => page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const map = getMapRuntime()!.getMap(), size = map.getSize(), viewport = map.getViewport()
    return !map.getView().getAnimating() && size?.[0] === viewport.clientWidth && size?.[1] === viewport.clientHeight
  })).toBe(true)
})

test('shared vertex drag is one edit and retains holes, multi-part geometry and unselected records', async ({ page }, info) => {
  const before = await snapshot(page), datasetId = before.project.layers[0].datasetId
  await drag(page, await pixel(page))
  await expect.poll(async () => (await snapshot(page)).featuresByDataset).not.toEqual(before.featuresByDataset)
  const after = await snapshot(page), [a, b, other] = after.featuresByDataset[datasetId], [oldA, oldB, oldOther] = before.featuresByDataset[datasetId]
  expect(a.geometry).not.toEqual(oldA.geometry); expect(b.geometry).not.toEqual(oldB.geometry)
  expect(other).toEqual(oldOther)
  expect(a.properties).toEqual(oldA.properties); expect(b.properties).toEqual(oldB.properties)
  if (a.geometry.type !== 'Polygon' || b.geometry.type !== 'MultiPolygon') throw new Error('Geometry type changed')
  if (oldA.geometry.type === 'Polygon') expect(a.geometry.coordinates[1]).toEqual(oldA.geometry.coordinates[1])
  expect(a.geometry.coordinates[0][1]).toEqual(b.geometry.coordinates[0][0][0])
  if (oldB.geometry.type === 'MultiPolygon') expect(b.geometry.coordinates[1]).toEqual(oldB.geometry.coordinates[1])
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(await snapshot(page)).toEqual(after)
  // A second drag uses refreshed native features rather than stale selection references.
  await drag(page, await pixel(page))
  await expect.poll(async () => (await snapshot(page)).featuresByDataset).not.toEqual(after.featuresByDataset)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(after)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = info.outputPath('multi-vertex.webgis.json')
  await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  expect(saved.featuresByDataset).toEqual(after.featuresByDataset)
  await page.locator('button[aria-label="结束编辑"]').click()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await chooser).setFiles(path)
  expect(await snapshot(page)).toEqual(saved)
})

test('Escape during shared-vertex drag restores native geometry and adds no history step', async ({ page }) => {
  const before = await snapshot(page), point = await pixel(page)
  await drag(page, point, true)
  expect(await snapshot(page)).toEqual(before)
  expect(await pixel(page)).toEqual(point)
  await drag(page, point)
  await expect.poll(async () => (await snapshot(page)).featuresByDataset).not.toEqual(before.featuresByDataset)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
})

test('shared edge vertex insertion and Alt deletion each undo in one step', async ({ page }) => {
  const before = await snapshot(page), datasetId = before.project.layers[0].datasetId
  await drag(page, await pixel(page, true))
  const inserted = await snapshot(page), [a, b] = inserted.featuresByDataset[datasetId]
  if (a.geometry.type !== 'Polygon' || b.geometry.type !== 'MultiPolygon') throw new Error('Geometry type changed')
  expect(a.geometry.coordinates[0]).toHaveLength(6)
  expect(b.geometry.coordinates[0][0]).toHaveLength(6)
  const point = await page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const runtime = getMapRuntime()!, layer = useProjectStore.getState().project.layers[0]
    const geometry = runtime.registry.getVector(layer.id)!.getSource()!.getFeatures().find(feature => feature.get('name') === 'A')!.getGeometry() as unknown as { getCoordinates(): number[][][] }
    return runtime.getMap().getPixelFromCoordinate(geometry.getCoordinates()[0][2])
  })
  const position = await pointer(page, point)
  await page.keyboard.down('Alt'); await page.mouse.click(position.x, position.y); await page.keyboard.up('Alt')
  await expect.poll(async () => (await snapshot(page)).featuresByDataset).toEqual(before.featuresByDataset)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(inserted)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
})

test('invalid shared vertex geometry rolls back the complete gesture and leaves the next edit usable', async ({ page }) => {
  const before = await snapshot(page)
  const targets = await page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const runtime = getMapRuntime()!, map = runtime.getMap(), layer = useProjectStore.getState().project.layers[0]
    map.getView().setZoom(map.getView().getZoom()! - 1)
    map.renderSync()
    const geometry = runtime.registry.getVector(layer.id)!.getSource()!.getFeatures().find(feature => feature.get('name') === 'A')!.getGeometry() as unknown as { getCoordinates(): number[][][] }
    const ring = geometry.getCoordinates()[0]
    return { from: map.getPixelFromCoordinate(ring[1]), to: map.getPixelFromCoordinate([ring[0][0] + (ring[2][0] - ring[0][0]) * .7, ring[2][1] + (ring[2][1] - ring[1][1]) * .2]) }
  })
  const from = await pointer(page, targets.from), to = await pointer(page, targets.to)
  await page.mouse.move(from.x, from.y); await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up()
  await expect(page.locator('.status-message')).toContainText('未提交本次编辑')
  await expect(page.locator('.status-message')).toContainText('自相交')
  expect(await snapshot(page)).toEqual(before)
  expect(await pixel(page)).toEqual(targets.from)
  await drag(page, await pixel(page))
  await expect.poll(async () => (await snapshot(page)).featuresByDataset).not.toEqual(before.featuresByDataset)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await snapshot(page)).toEqual(before)
})
