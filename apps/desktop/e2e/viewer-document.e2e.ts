import { expect, test } from '@playwright/test'

const style = { mode: 'single', symbol: { type: 'circle', radius: 12, fill: { r: 255, g: 0, b: 0, a: 1 } } }
const interaction = { selectable: true, popup: { titleField: 'name', fields: [{ field: 'name', label: '名称' }] } }
const data = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 1, geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: '中心点' } }] }
const view = { projection: 'EPSG:3857', center: [0, 0], zoom: 3 }

for (const version of [2, 3]) {
  test(`Viewer loads version ${version}, resolves resources and preserves popup and visibility`, async ({ page }) => {
    const resource = { type: 'geojson', url: './points.geojson' }
    const layer = { type: 'vector', id: 'points', name: '测试点', visible: true, style, interaction }
    const scene = version === 3
      ? { version, id: 'viewer', title: 'Viewer v3', activeView: 'map', views: { map: { type: '2d', ...view } }, resources: { data: resource }, nodes: [{ ...layer, resource: 'data' }], widgets: { layerSwitcher: true, legend: true } }
      : { version, id: 'viewer', title: 'Viewer v2', view, sources: { data: resource }, layers: [{ ...layer, source: 'data' }], widgets: { layerSwitcher: true, legend: true } }
    await page.route('**/fixtures/scene.json', route => route.fulfill({ json: scene }))
    // Redirected requests bypass Playwright's second route: serve the actual public v3 example.
    if (version === 3) await page.route('**/entry/scene.json', route => route.fulfill({ status: 302, headers: { location: '/examples/v3/scene.json' } }))
    let resourceRequests = 0
    await page.route(version === 3 ? '**/examples/v3/points.geojson' : '**/fixtures/points.geojson', route => { resourceRequests++; return route.fulfill({ json: data }) })
    await page.goto(`/?scene=./${version === 3 ? 'entry' : 'fixtures'}/scene.json&mode=2d`)
    await expect(page.locator('#scene-title')).toHaveText(`Viewer v${version}`)
    await expect(page.locator('#scene-status')).toHaveText('场景已加载')
    expect(resourceRequests).toBe(1)
    await expect(page.locator('#legend-list')).toContainText('测试点')
    const map = page.locator('#map'), box = await map.boundingBox()
    if (!box) throw new Error('Map missing')
    await expect(async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect(page.locator('#popup-title')).toHaveText('中心点')
      await expect(page.locator('#popup')).toBeVisible()
    }).toPass()
    await expect(async () => {
      const highlighted = await page.locator('#map canvas').evaluateAll(canvases => canvases.some(element => {
        const canvas = element as HTMLCanvasElement, context = canvas.getContext('2d')
        if (!context) return false
        const pixels = context.getImageData(Math.floor(canvas.width / 2) - 20, Math.floor(canvas.height / 2) - 20, 40, 40).data
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] > 180 && pixels[index + 1] > 120 && pixels[index + 2] < 100 && pixels[index + 3] > 0) return true
        }
        return false
      }))
      expect(highlighted).toBe(true)
    }).toPass()
    await page.locator('#popup-close').click()
    const toggle = page.locator('#layer-list input')
    await toggle.uncheck()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.locator('#popup')).toBeHidden()
    await toggle.check()
    await expect(async () => {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
      await expect(page.locator('#popup')).toBeVisible()
    }).toPass()
    expect(resourceRequests).toBe(1)
    await page.locator('#popup-close').click()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 90)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2 + 90, { steps: 8 })
    // Pause while holding the mouse to end the gesture without kinetic pan after release.
    await page.waitForTimeout(200)
    await page.mouse.up()
    await expect(async () => {
      await page.mouse.click(box.x + box.width / 2 + 80, box.y + box.height / 2)
      await expect(page.locator('#popup')).toBeVisible()
    }).toPass()
  })
}

test('Viewer prepares a real GLB while hidden before publishing the city scene', async ({ page }) => {
  const scene = { version: 3, id: 'prepared-model', title: 'Prepared model', activeView: 'city', resources: {
    tower: { type: 'glb', url: './city-sample/tower.glb' }
  }, nodes: [{ type: 'model', id: 'tower', name: 'Tower', visible: true, resource: 'tower', position: [116.391, 39.907, 0], transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }], views: {
    city: { type: '3d', heightReference: 'ellipsoid', camera: { position: [116.391, 39.907, 2500], heading: 0, pitch: -45, roll: 0 } }
  } }
  await page.route('**/scene-model.json', route => route.request().isNavigationRequest() ? route.continue() : route.fulfill({ json: scene }))
  const modelResponse = page.waitForResponse(response => response.url().endsWith('/city-sample/tower.glb'))
  await page.goto('/?scene=./scene-model.json')
  expect((await modelResponse).ok()).toBe(true)
  await expect(page.locator('#scene-status')).toHaveText('三维场景已加载', { timeout: 30_000 })
  await expect(page.locator('.cesium-widget canvas')).toBeVisible()
  const toggle = page.locator('#layer-list input')
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await expect(toggle).toBeChecked()
})

test('Viewer reports retained unsupported objects and load failures', async ({ page }) => {
  const scene = { version: 3, id: 'mixed', title: 'Mixed', activeView: 'map', views: { map: { type: '2d', ...view } }, resources: { model: { type: 'glb', url: './model.glb' } }, nodes: [{ type: 'model', id: 'model', name: 'Model', visible: true, resource: 'model', position: [0, 0, 0], transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }] }
  await page.route('**/fixtures/scene.json', route => route.fulfill({ json: scene }))
  await page.goto('/?scene=./fixtures/scene.json&mode=2d')
  await expect(page.locator('#scene-status')).toContainText('OL does not render model')
  await page.route('**/fixtures/broken.json', route => route.request().isNavigationRequest() ? route.continue() : route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.goto('/?scene=./fixtures/broken.json')
  await expect(page.locator('#scene-status')).toContainText('HTTP 503')
})

test('Viewer respects the canonical active view and can explicitly open the 3D runtime', async ({ page }) => {
  const scene = { version: 3, id: 'views', title: 'Two engines', activeView: 'map', resources: {}, nodes: [], views: {
    map: { type: '2d', ...view }, city: { type: '3d', heightReference: 'ellipsoid', camera: { position: [116.391, 39.907, 2500], heading: 0, pitch: -45, roll: 0 } }
  } }
  await page.route('**/fixtures/views.json*', route => route.request().isNavigationRequest() ? route.continue() : route.fulfill({ json: scene }))
  await page.goto('/?scene=./fixtures/views.json')
  await expect(page.locator('#scene-status')).toHaveText('场景已加载')
  await expect(page.locator('.ol-viewport')).toBeVisible()
  await page.goto('/?scene=./fixtures/views.json&mode=3d')
  await expect(page.locator('#scene-status')).toHaveText('三维场景已加载', { timeout: 30_000 })
  await expect(page.locator('.cesium-widget canvas')).toBeVisible()
  await page.getByRole('link', { name: '查看二维地图' }).click()
  await expect(page.locator('#scene-status')).toHaveText('场景已加载')
})
