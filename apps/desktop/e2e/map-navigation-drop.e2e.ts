import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createCesiumScene } from '@desktop-webgis/cesium-scene-schema'

test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false }, actionTimeout: 15_000 })
const data = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: '拖入道路', value: 42 }, geometry: { type: 'LineString', coordinates: [[116, 39], [116.01, 39.01]] } }] })
async function setup(page: Page) {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.getByTestId('map-runtime-viewport')).toBeVisible()
}
async function drop(page: Page, target: string, names = ['roads.geojson'], content = data) {
  const files = await page.evaluateHandle(({ data, names }) => {
    const transfer = new DataTransfer()
    names.forEach(name => transfer.items.add(new File([data], name, { type: 'application/json' })))
    return transfer
  }, { data: content, names })
  await page.locator(target).dispatchEvent('dragover', { dataTransfer: files })
  await page.locator(target).dispatchEvent('drop', { dataTransfer: files })
  await files.dispose()
}
async function state(page: Page) {
  return page.evaluate(async () => {
    const { projectSession } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-session.ts').at(-1) ?? '/src/project/project-session.ts')

    const selectionSession = (await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/stores/layer-view.store.ts').at(-1) ?? '/src/stores/layer-view.store.ts')).useLayerViewStore.getState()

    const host = await import('/src/engine-host/map-runtime-host.ts')
    const store = (await import('/src/project/project.store.ts')).useProjectStore.getState()
    return { center: host.getMapRuntime()!.getMap().getView().getCenter(), snapshot: projectSession.getSnapshot(), selection: selectionSession.selection, tool: host.getActiveEditTool() }
  })
}
async function drag(page: Page, button: 'middle' | 'left', space = false) {
  const box = (await page.getByTestId('map-runtime-viewport').boundingBox())!
  // Selection can open the bottom dock; keep navigation above its overlay.
  const x = box.x + box.width * .6, y = box.y + box.height * .3
  await page.mouse.move(x, y)
  if (space) await page.keyboard.down('Space')
  await page.mouse.down({ button })
  await page.mouse.move(x + 75, y + 35, { steps: 8 })
  await page.mouse.up({ button })
  if (space) await page.keyboard.up('Space')
}

for (const [name, target] of [['地图', '[data-testid=map-runtime-viewport]'], ['图层面板', '[aria-label="图层面板"]']] as const) test(`drop on ${name} previews, commits once, and undoes`, async ({ page }) => {
  await setup(page)
  const before = await state(page)
  await drop(page, target)
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeVisible()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await expect(page.locator('.layer-name-button').filter({ hasText: 'roads' })).toBeVisible()
  expect((await state(page)).snapshot.project.content.layers).toHaveLength(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
})

test('rejects multiple and unsupported files; cancellation leaves the project unchanged', async ({ page }) => {
  await setup(page)
  const before = await state(page)
  await drop(page, '[data-testid=map-runtime-viewport]', ['a.geojson', 'b.geojson'])
  await expect(page.getByText('一次请拖入一个文件；SHP 请使用 ZIP。', { exact: true })).toBeVisible()
  await drop(page, '[data-testid=map-runtime-viewport]', ['a.exe'])
  await expect(page.getByText('支持拖入 GeoJSON、SHP ZIP、DXF 或 CSV 文件。', { exact: true })).toBeVisible()
  await drop(page, '[data-testid=map-runtime-viewport]')
  await expect(page.getByRole('button', { name: '确认导入', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭添加数据', exact: true }).click()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
})

test('file drop on an existing layer row adds data without reordering the layer', async ({ page }) => {
  await setup(page)
  await drop(page, '[data-testid=map-runtime-viewport]')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  const before = await state(page)
  await drop(page, '.layer-name-button')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  expect((await state(page)).snapshot.project.content.layers).toHaveLength(2)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
})

test('dragging project and scene files uses their own validated entry points', async ({ page, context }, info) => {
  await setup(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = info.outputPath('drop.webgis.json')
  await (await download).saveAs(path)
  await page.reload()
  await expect(page.getByRole('main', { name: '项目起始页' })).toBeVisible()
  await drop(page, '.project-start', ['map.WEBGIS.JSON'], await readFile(path, 'utf8'))
  await expect(page.locator('.status-message')).toContainText('已打开项目：map.WEBGIS.JSON')
  await expect(page.getByRole('dialog', { name: '添加数据' })).toHaveCount(0)

  await drop(page, '[data-testid=map-runtime-viewport]', ['roads.geojson'])
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  const layer = page.locator('.layer-name-button').filter({ hasText: 'roads' })
  await expect(layer).toBeVisible()
  const scene = JSON.stringify(createCesiumScene())
  await drop(page, '[data-testid=map-runtime-viewport]', ['city.scene.json'], scene)
  await expect(page.locator('.status-message')).toContainText('请在三维项目中导入')
  await expect(page.getByRole('dialog', { name: '保存当前项目？' })).toHaveCount(0)
  await expect(layer).toBeVisible()

  const home = await context.newPage()
  await home.goto('/')
  await drop(home, '.project-start', ['city.scene.json'], scene)
  await expect(home.getByRole('main', { name: '三维场景编辑器' })).toBeVisible({ timeout: 30_000 })
  await expect(home.getByRole('dialog', { name: '添加数据' })).toHaveCount(0)
  await expect(home.locator('.project-dirty')).toHaveText('未保存')
})

test('新建和打开项目保留尚未完成的二维草图', async ({ page }, info) => {
  await setup(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const saved = info.outputPath('clean.webgis.json')
  await (await download).saveAs(saved)
  await drop(page, '[data-testid=map-runtime-viewport]')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.locator('.layer-name-button').filter({ hasText: 'roads' }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  await page.getByRole('button', { name: '绘制要素', exact: true }).click()
  const viewport = await page.getByTestId('map-runtime-viewport').boundingBox()
  expect(viewport).not.toBeNull()
  await page.mouse.click(viewport!.x + viewport!.width * 0.48, viewport!.y + viewport!.height * 0.42)

  const status = page.locator('.status-message')
  const newProject = page.getByRole('dialog', { name: '新建项目', exact: true })
  await page.keyboard.press('Control+n')
  await expect(status).toHaveText('请先完成当前几何编辑，或按 Esc 取消。')
  await expect(newProject).toHaveCount(0)
  const open = page.waitForEvent('filechooser')
  await page.keyboard.press('Control+o')
  await (await open).setFiles(saved)
  await expect(status).toHaveText('打开失败：请先完成当前几何编辑，或按 Esc 取消。')
  await expect(page.getByRole('dialog', { name: '保存当前项目？' })).toHaveCount(0)

  await page.mouse.dblclick(viewport!.x + viewport!.width * 0.65, viewport!.y + viewport!.height * 0.57)
  await expect.poll(async () => {
    const { snapshot } = await state(page)
    const rows = Object.values(snapshot.featuresByDataset).flat()
    return rows.map(row => row.geometry.coordinates.length)
  }).toEqual([2, 2])
  await page.keyboard.press('Control+n')
  await expect(newProject).toBeVisible()
  await newProject.getByRole('button', { name: '取消', exact: true }).click()
  await page.mouse.click(viewport!.x + viewport!.width * 0.48, viewport!.y + viewport!.height * 0.42)
  await page.keyboard.press('Escape')
  await expect(status).toContainText('已取消当前操作')
  await page.keyboard.press('Control+n')
  await expect(newProject).toBeVisible()
})

test('middle and space-left pan preserve selection and an unfinished drawing', async ({ page }) => {
  await setup(page)
  await drop(page, '[data-testid=map-runtime-viewport]')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.evaluate(async () => {
    const { getLayerFeatures } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/feature-query.ts').at(-1) ?? '/src/project/feature-query.ts')

    const store = (await import('/src/project/project.store.ts')).useProjectStore.getState()
    const layer = store.project.content.layers[0]
    const { selectionCommands } = await import('/src/commands/selection.commands.ts')
    selectionCommands.setSelection({ layerId: layer.id, featureIds: getLayerFeatures(layer.id).map(row => row.id) })
  })
  const before = await state(page)
  await drag(page, 'middle')
  const middle = await state(page)
  expect(middle.center).not.toEqual(before.center)
  expect(middle.selection).toEqual(before.selection)
  expect(middle.snapshot).toEqual(before.snapshot)
  expect(middle.tool).toBe('select')
  await drag(page, 'left', true)
  const spaced = await state(page)
  expect(spaced.center).not.toEqual(middle.center)
  expect(spaced.selection).toEqual(before.selection)
  expect(spaced.snapshot).toEqual(before.snapshot)
  await page.evaluate(async () => { (await import('/src/engine-host/map-runtime-host.ts')).setActiveEditTool('draw-line') })
  const box = (await page.getByTestId('map-runtime-viewport').boundingBox())!
  await page.mouse.click(box.x + box.width * .48, box.y + box.height * .5)
  await drag(page, 'middle')
  await drag(page, 'left', true)
  expect((await state(page)).tool).toBe('draw-line')
  expect((await state(page)).snapshot).toEqual(before.snapshot)
  await page.mouse.dblclick(box.x + box.width * .65, box.y + box.height * .65)
  await expect.poll(async () => {
    const current = await state(page), layer = current.snapshot.project.content.layers[0]
    return current.snapshot.featuresByDataset[layer.datasetId].length
  }).toBe(2)
  const current = await state(page), layer = current.snapshot.project.content.layers[0]
  expect(current.snapshot.featuresByDataset[layer.datasetId][1].geometry.coordinates).toHaveLength(2)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await state(page)).snapshot).toEqual(before.snapshot)
})

test('compact ribbon leaves map space and keeps commands reachable', async ({ page }) => {
  await setup(page)
  const ribbon = page.getByRole('region', { name: '二维功能区' })
  const expectedHeight = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement)
    return parseFloat(css.getPropertyValue('--tab-height')) + parseFloat(css.getPropertyValue('--ribbon-tool-height')) + 8
  })
  expect((await ribbon.boundingBox())!.height).toBe(expectedHeight)
  for (const name of ['数据', '编辑', '分析']) {
    await page.getByRole('tab', { name, exact: true }).click()
    await expect(page.getByTestId('map-runtime-viewport')).toBeVisible()
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

test('space in inputs is text; blur releases temporary pan and left drag selects again', async ({ page }) => {
  await setup(page)
  await drop(page, '[data-testid=map-runtime-viewport]')
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('button', { name: '搜索图层', exact: true }).click()
  const search = page.getByRole('textbox', { name: /搜索图层/ })
  await search.fill('a')
  await search.press('Space')
  await expect(search).toHaveValue('a ')
  await search.fill('')
  await page.getByTestId('map-runtime-viewport').click({ position: { x: 450, y: 200 } })
  const before = await state(page)
  await page.keyboard.down('Space')
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.keyboard.up('Space')
  await drag(page, 'left')
  expect((await state(page)).center).toEqual(before.center)
  expect((await state(page)).tool).toBe('select')
  await drag(page, 'left', true)
  expect((await state(page)).center).not.toEqual(before.center)
})
