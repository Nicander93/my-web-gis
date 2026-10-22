import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const scene = {
  version: 3, id: 'professional', title: 'Professional drawing', activeView: 'map',
  views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 10 } },
  resources: { roads: { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'road', geometry: { type: 'LineString', coordinates: [[-0.1, 0], [0.1, 0]] }, properties: { name: '主干道', width: 3, kind: 'primary' } }] } }, points: { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'point', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: '站点' } }] } } },
  nodes: [{ id: 'roads', name: '道路', type: 'vector', resource: 'roads', style: { mode: 'single', symbol: { type: 'solid', color: { r: 20, g: 40, b: 60, a: 1 }, width: 2 } } }, { id: 'points', name: '地点', type: 'vector', resource: 'points', style: { mode: 'single', symbol: { type: 'circle', radius: 5, fill: { r: 20, g: 40, b: 60, a: 1 } } } }],
}

async function start(page: Page, layerName: string) {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: 'professional.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) })
  await page.locator('.layer-name-button').filter({ hasText: layerName }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '样式', exact: true }).click()
}

async function select(page: Page, label: string, text: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: new RegExp(`^${text}$`) }).click()
}

async function inspect(page: Page, id: string) {
  return page.evaluate(async id => {
    const loaded = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(loaded('/src/stores/project.store.ts')) as typeof import('../src/stores/project.store')
    const { getMapRuntime } = await import(loaded('/src/features/map/map-runtime-host.ts')) as typeof import('../src/features/map/map-runtime-host')
    const state = useProjectStore.getState(), binding = state.project.cartography.bindings.find(binding => binding.gisLayerId === id)!
    const native = getMapRuntime()?.registry.getVector(id), feature = native?.getSource()?.getFeatures()[0]
    const result = feature ? native?.getStyleFunction()?.(feature, getMapRuntime()!.getMap().getView().getResolution()!) : undefined
    const styles = result ? Array.isArray(result) ? result : [result] : []
    return { layers: structuredClone(state.project.cartography.styleLayers.filter(layer => binding.styleLayerIds.includes(layer.id))), assets: structuredClone(state.project.cartography.assets ?? []), widths: styles.map(style => style.getStroke()?.getWidth() ?? null), texts: styles.map(style => style.getText()?.getFont() ?? null), images: styles.map(style => ({ size: style.getImage()?.getSize(), state: style.getImage()?.getImageState() })) }
  }, id)
}

test('professional layered roads, zoom widths and undo retain standard AST', async ({ page }) => {
  await start(page, '道路')
  await page.getByRole('button', { name: '选择符号…', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择符号', exact: true })
  await picker.getByRole('row').filter({ hasText: '主干道路' }).getByRole('button', { name: '使用', exact: true }).click()
  await expect.poll(async () => (await inspect(page, 'roads')).widths).toEqual([8, 5])
  await picker.getByRole('button', { name: '关闭', exact: true }).last().click()
  await page.getByRole('button', { name: '专业符号编辑…', exact: true }).click()
  const editor = page.getByRole('dialog', { name: /专业符号/ })
  await select(page, '线宽方式', 'Zoom 线性')
  await expect.poll(async () => (await inspect(page, 'roads')).layers[0].paint?.['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 0, 1, 24, 3])
  await editor.getByRole('spinbutton', { name: '线不透明度', exact: true }).fill('0.5')
  await editor.getByRole('spinbutton', { name: '线不透明度', exact: true }).blur()
  expect((await inspect(page, 'roads')).layers[0].paint?.['line-width']).toEqual(['interpolate', ['linear'], ['zoom'], 0, 1, 24, 3])
  await editor.getByRole('button', { name: /^(Close|关闭)$/ }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect((await inspect(page, 'roads')).layers[0].paint?.['line-opacity']).toBeUndefined()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await inspect(page, 'roads')).widths).toEqual([8, 5])
  await page.getByRole('button', { name: '查看与编辑规则列表', exact: true }).click()
  const before = (await inspect(page, 'roads')).layers
  const rules = page.getByRole('region', { name: '规则渲染', exact: true })
  await rules.getByRole('button', { name: `隐藏规则 ${before[0].id}`, exact: true }).click()
  await expect.poll(async () => (await inspect(page, 'roads')).widths).toEqual([5])
  expect((await inspect(page, 'roads')).layers[0].paint).toEqual(before[0].paint)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await inspect(page, 'roads')).widths).toEqual([8, 5])
  expect((await inspect(page, 'roads')).layers).toEqual(before)
})

test('safe SVG survives resource import, actual icon rendering, save and project reopen', async ({ page }, info) => {
  const externalSpriteRequests: string[] = []
  page.on('request', request => { if (request.url().includes('project-cartography.invalid')) externalSpriteRequests.push(request.url()) })
  await start(page, '地点')
  await page.getByRole('button', { name: '选择符号…', exact: true }).click()
  await page.getByRole('button', { name: '管理符号库与项目资源…', exact: true }).click()
  const manager = page.getByRole('dialog', { name: '符号库与项目资源', exact: true })
  const asset = { name: 'station.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#ff6600"/></svg>') }
  const chooser = page.waitForEvent('filechooser')
  await manager.getByRole('button', { name: '导入项目资源', exact: true }).click()
  await (await chooser).setFiles(asset)
  const row = manager.getByRole('row').filter({ hasText: 'station.svg' })
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: '用于当前图层', exact: true }).click()
  await expect.poll(async () => (await inspect(page, 'points')).images.some(image => image.state === 2 && image.size?.[0] === 24)).toBe(true)
  const before = await inspect(page, 'points')
  expect(before.assets).toHaveLength(1)
  expect(externalSpriteRequests).toEqual([])
  await manager.getByRole('button', { name: '关闭', exact: true }).last().click()
  await page.getByRole('dialog', { name: '选择符号', exact: true }).getByRole('button', { name: '关闭', exact: true }).last().click()
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const path = info.outputPath('portable-svg.webgis.json')
  await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  expect(saved.project.cartography.assets).toEqual(before.assets)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const reopen = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await reopen).setFiles(path)
  await expect.poll(async () => (await inspect(page, 'points')).images.some(image => image.state === 2 && image.size?.[0] === 24)).toBe(true)
  expect((await inspect(page, 'points')).assets).toEqual(before.assets)
  expect(externalSpriteRequests).toEqual([])
})

for (const format of ['sld', 'mbstyle'] as const) {
test(`${format} GeoServer wizard publishes against the isolated real server and persists only a credential reference`, async ({ page }, info) => {
  test.skip(process.env.CARTOGRAPHY_GEOSERVER_URL !== 'http://127.0.0.1:18085/geoserver', 'Requires the isolated GeoServer 2.28.2 lab')
  // Node bridges CORS for the browser UI; native request/cancel behavior has separate Rust tests.
  let mutations = 0
  await page.route('http://127.0.0.1:18085/**', async route => {
    if (route.request().method() === 'POST' && route.request().url().includes('/styles?')) mutations++
    await route.fulfill({ response: await route.fetch() })
  })
  await start(page, '道路')
  await page.getByRole('button', { name: '发布到 GeoServer…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /发布“道路”到 GeoServer/ })
  await dialog.getByRole('textbox', { name: '连接名称', exact: true }).fill('Local acceptance')
  await dialog.getByRole('textbox', { name: 'GeoServer 根地址', exact: true }).fill('http://127.0.0.1:18085/geoserver')
  await dialog.getByRole('textbox', { name: '用户名（Basic Auth）', exact: true }).fill('admin')
  await dialog.getByLabel('密码', { exact: true }).fill(process.env.CARTOGRAPHY_GEOSERVER_PASSWORD ?? 'geoserver')
  await dialog.getByRole('button', { name: '连接并发现 Workspace', exact: true }).click()
  await select(page, 'Workspace', 'sf')
  await select(page, 'Datastore', 'sf')
  await select(page, '已有要素类型', 'roads')
  await dialog.getByRole('button', { name: '继续预检', exact: true }).click()
  if (format === 'mbstyle') await select(page, '远端样式格式', 'MBStyle JSON')
  await dialog.getByRole('textbox', { name: `远端 ${format === 'sld' ? 'SLD' : 'MBStyle'} 样式名`, exact: true }).fill(`cartography-ui-${format}-${Date.now()}`)
  await dialog.getByRole('button', { name: '运行远端预检', exact: true }).click()
  if (format === 'mbstyle') await dialog.getByRole('checkbox', { name: '我已阅读兼容报告，并同意按报告中的近似方式发布。', exact: true }).check()
  const publish = dialog.getByRole('button', { name: '发布并验证', exact: true })
  await expect(publish).toBeEnabled()
  await publish.dblclick()
  await expect(dialog.getByRole('button', { name: '加载已发布 WMS', exact: true })).toBeVisible()
  expect(mutations).toBe(1)
  const persisted = await page.evaluate(async () => {
    const path = '/src/stores/project.store.ts', url = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(url) as typeof import('../src/stores/project.store')
    return { project: useProjectStore.getState().getSnapshot(), local: Object.fromEntries(Object.entries(localStorage)) }
  })
  const link = persisted.project.project.layers.find(layer => layer.id === 'roads')!.publishedStyle!
  expect(link.remoteFormat).toBe(format)
  expect(link.lastPublishedHash).toMatch(/^[a-f\d]{64}$/)
  expect(JSON.stringify(persisted)).not.toContain('Basic ')
  expect(JSON.stringify(persisted)).not.toContain(Buffer.from('admin:geoserver').toString('base64'))
  await dialog.getByRole('button', { name: '加载已发布 WMS', exact: true }).click()
  await expect(page.locator('.layer-name-button').filter({ hasText: 'sf:roads（已发布）' })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const path = info.outputPath('published-style.webgis.json')
  await (await download).saveAs(path)
  const saved = readFileSync(path, 'utf8')
  expect(JSON.parse(saved).project.layers.find((layer: { id: string }) => layer.id === 'roads').publishedStyle).toEqual(link)
  expect(saved).not.toContain(Buffer.from('admin:geoserver').toString('base64'))
  await page.unrouteAll({ behavior: 'wait' })
})
}

test('embedded WOFF2 installs before label compilation and survives project history', async ({ page }) => {
  await start(page, '地点')
  await page.getByRole('button', { name: '专业符号编辑…', exact: true }).click()
  await select(page, '新增绘制层类型', '文字符号')
  await page.getByRole('dialog', { name: /专业符号/ }).getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '选择符号…', exact: true }).click()
  await page.getByRole('button', { name: '管理符号库与项目资源…', exact: true }).click()
  const manager = page.getByRole('dialog', { name: '符号库与项目资源', exact: true })
  await manager.getByRole('textbox', { name: '字体名称', exact: true }).fill('LabNoto')
  await manager.getByRole('textbox', { name: '资源来源', exact: true }).fill('Google Fonts / Noto Sans Latin')
  await manager.getByRole('textbox', { name: '资源许可', exact: true }).fill('OFL-1.1')
  const chooser = page.waitForEvent('filechooser')
  await manager.getByRole('button', { name: '导入项目资源', exact: true }).click()
  await (await chooser).setFiles(fileURLToPath(new URL('./fixtures/cartography-font.woff2', import.meta.url)))
  const row = manager.getByRole('row').filter({ hasText: 'cartography-font.woff2' })
  await row.getByRole('button', { name: '用于当前图层', exact: true }).click()
  await expect.poll(async () => (await inspect(page, 'points')).texts.some(font => font?.includes('LabNoto'))).toBe(true)
  expect(await page.evaluate(() => document.fonts.check('12px "LabNoto"'))).toBe(true)
  expect((await inspect(page, 'points')).assets[0]).toMatchObject({ mimeType: 'font/woff2', fontFamily: 'LabNoto', attribution: { license: 'OFL-1.1' } })
  await manager.getByRole('button', { name: '关闭', exact: true }).last().click()
  await page.getByRole('dialog', { name: '选择符号', exact: true }).getByRole('button', { name: '关闭', exact: true }).last().click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await inspect(page, 'points')).layers.find(layer => layer.type === 'symbol')?.layout?.['text-font']).toBeUndefined()
  expect((await inspect(page, 'points')).assets).toHaveLength(1)
})

test('offline SLD export requires an explicit geometry field and exports real XML', async ({ page }, info) => {
  await start(page, '道路')
  await page.getByRole('button', { name: '导出 SLD…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '导出 SLD', exact: true })
  await expect(dialog.getByRole('button', { name: '仅导出 XML', exact: true })).toBeDisabled()
  await dialog.getByRole('textbox', { name: 'SLD几何字段', exact: true }).fill('the_geom')
  await expect(dialog.getByRole('button', { name: '仅导出 XML', exact: true })).toBeEnabled()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: '仅导出 XML', exact: true }).click()
  const path = info.outputPath('roads.sld')
  await (await download).saveAs(path)
  const xml = readFileSync(path, 'utf8')
  expect(xml).toContain('StyledLayerDescriptor')
  expect(xml).toContain('<sld:LineSymbolizer>')
  expect(xml).toContain('geometryType')
  expect(xml).toContain('the_geom')
})
