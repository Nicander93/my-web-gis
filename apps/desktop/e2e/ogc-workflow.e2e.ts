import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('WMS and WMTS catalog selection, order and opacity survive a project file round trip', async ({ page }) => {
  const requests: URL[] = []
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.route('https://example.com/**', async route => {
    const url = new URL(route.request().url())
    // OGC KVP parameter names are case-insensitive; OL's WMTS uses mixed casing.
    for (const [name, value] of [...url.searchParams]) url.searchParams.set(name.toUpperCase(), value)
    const request = url.searchParams.get('REQUEST')?.toLowerCase()
    if (request === 'getcapabilities') {
      const file = url.pathname.includes('wmts') ? 'wmts-1.0.0-capabilities.xml' : 'wms-1.3.0-capabilities.xml'
      return route.fulfill({ contentType: 'text/xml', body: readFileSync(new URL(`../../../examples/phase-1/ogc/${file}`, import.meta.url)) })
    }
    requests.push(url)
    return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') })
  })
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await addService(page, 'WMS', 'Cities')
  await addService(page, 'WMTS', 'Ortho')
  await expect(page.locator('.layer-name-button')).toHaveCount(2)
  await page.getByLabel('更多操作 Cities', { exact: true }).click()
  await page.getByRole('menuitem', { name: '上移图层', exact: true }).click()
  await expect(page.locator('.layer-name-button').first()).toHaveText('Cities')
  await page.getByRole('button', { name: 'Cities', exact: true }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '图层属性', exact: true }).click()
  const opacity = page.locator('.inspector-opacity input')
  await opacity.fill('35')
  await expect.poll(() => nativeLayers(page)).toContainEqual(expect.objectContaining({ name: 'Cities', opacity: 0.35 }))
  await expect.poll(() => requests.some(url => url.searchParams.get('REQUEST')?.toLowerCase() === 'getmap')).toBe(true)
  await expect.poll(() => requests.some(url => url.searchParams.get('REQUEST')?.toLowerCase() === 'gettile')).toBe(true)
  const wms = requests.find(url => url.searchParams.get('REQUEST')?.toLowerCase() === 'getmap')!
  expect(wms.searchParams.get('LAYERS')).toBe('cities')
  expect(wms.searchParams.get('VERSION')).toBe('1.3.0')
  const wmts = requests.find(url => url.searchParams.get('REQUEST')?.toLowerCase() === 'gettile')!
  expect(wmts.searchParams.get('LAYER')).toBe('ortho')
  expect(wmts.searchParams.get('TILEMATRIXSET')).toBe('GoogleMapsCompatible')
  const before = await nativeLayers(page)
  expect(before.find(layer => layer.name === 'Cities')!.index).toBeGreaterThan(before.find(layer => layer.name === 'Ortho')!.index)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const download = await downloadEvent, body = readFileSync((await download.path())!)
  const saved = JSON.parse(body.toString('utf8'))
  expect(saved.project.datasets.map(dataset => dataset.kind).sort()).toEqual(['wms', 'wmts'])
  await page.reload()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooserEvent = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await chooserEvent).setFiles({ name: 'services.webgis.json', mimeType: 'application/json', buffer: body })
  await expect(page.locator('.layer-name-button').first()).toHaveText('Cities')
  await expect(page.locator('.layer-name-button')).toHaveCount(2)
  await expect.poll(() => nativeLayers(page)).toEqual(before)
})

async function addService(page: Page, type: string, layer: string) {
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '添加数据', exact: true })
  await dialog.getByRole('button', { name: '地图服务', exact: true }).click()
  await dialog.getByLabel('服务 URL').fill(`https://example.com/${type.toLowerCase()}`)
  await dialog.getByLabel('服务类型').selectOption(type)
  await dialog.getByRole('button', { name: '连接并读取 Capabilities', exact: true }).click()
  await dialog.getByRole('checkbox', { name: new RegExp(layer) }).check()
  await dialog.getByRole('button', { name: '添加选中的 1 项到项目', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function nativeLayers(page: Page) {
  return page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const runtime = getMapRuntime(), project = useProjectStore.getState().project
    return project.layers.map(layer => ({ name: layer.name, opacity: runtime?.registry.get(layer.id)?.getOpacity(),
      type: runtime?.registry.get(layer.id)?.getSource()?.constructor.name,
      index: runtime?.getMap().getLayers().getArray().indexOf(runtime.registry.get(layer.id)!) }))
  })
}
