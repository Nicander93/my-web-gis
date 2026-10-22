import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const drawing = {
  specVersion: 8,
  bindings: ['lower', 'upper'].map(id => ({ gisLayerId: id, datasetId: 'points', styleSourceId: 'shared-points', styleLayerIds: [`${id}-circle`] })),
  styleLayers: ['lower', 'upper'].map((id, index) => ({ id: `${id}-circle`, source: 'shared-points', type: 'circle', paint: {
    'circle-color': index ? '#00ff00' : '#ff0000', 'circle-radius': index ? ['interpolate', ['linear'], ['zoom'], 0, 9, 24, 9] : 17,
  } })),
}
const scene = {
  version: 3, id: 'cartography-project', title: 'Standard drawing', activeView: 'map',
  views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 4 } },
  resources: { points: { type: 'geojson', data: { type: 'FeatureCollection', features: [0, 1].map(value => ({
    type: 'Feature', id: `point-${value}`, geometry: { type: 'Point', coordinates: [value, 0] }, properties: { value },
  })) } } },
  nodes: ['lower', 'upper'].map(id => ({ id, name: id, type: 'vector', resource: 'points', visible: true, opacity: 0.8,
    filter: [{ field: 'value', op: 'eq', value: id === 'lower' ? 0 : 1 }],
    style: { mode: 'single', symbol: { type: 'circle', radius: 4, fill: { r: 0, g: 0, b: 255, a: 1 } } },
  })),
  extensions: { 'org.my-web-gis.cartography': { version: 1, required: true, data: drawing } },
}

async function nativeState(page: Page) {
  return page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/features/map/map-runtime-host.ts').at(-1)
    const { getMapRuntime } = await import(moduleUrl ?? '/src/features/map/map-runtime-host.ts') as typeof import('../src/features/map/map-runtime-host')
    const runtime = getMapRuntime()
    const lower = runtime?.registry.getVector('lower'), upper = runtime?.registry.getVector('upper')
    if (!lower || !upper) return { runtime: Boolean(runtime), ids: runtime?.registry.entries().map(([id]) => id) }
    const radius = (layer: typeof lower, value: number) => {
      const feature = layer.getSource()!.getFeatures().find(feature => feature.get('value') === value)!
      const styles = layer.getStyleFunction()!(feature, runtime!.getMap().getView().getResolution()!)
      const style = Array.isArray(styles) ? styles[0] : styles
      return (style?.getImage() as unknown as { getRadius(): number } | undefined)?.getRadius() ?? null
    }
    return { sharedSource: lower.getSource() === upper.getSource(), lower: radius(lower, 0), upper: radius(upper, 1),
      lowerExcluded: radius(lower, 1), upperExcluded: radius(upper, 0), count: lower.getSource()!.getFeatures().length }
  })
}

test('standard styles survive scene import, node deletion undo, project save and reopen over a shared source', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('地图资源')) console.error(message.text()) })
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: '导入场景', exact: true }).click()
  await (await chooser).setFiles({ name: 'drawing.scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) })
  const expected = { sharedSource: true, lower: 17, upper: 9, lowerExcluded: null, upperExcluded: null, count: 2 }
  await expect.poll(() => nativeState(page)).toEqual(expected)
  await page.evaluate(async () => {
    const loaded = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { createMapPropertyPreview, getMapRuntime } = await import(loaded('/src/features/map/map-runtime-host.ts')) as typeof import('../src/features/map/map-runtime-host')
    const { useProjectStore } = await import(loaded('/src/stores/project.store.ts')) as typeof import('../src/stores/project.store')
    const state = useProjectStore.getState(), base = state.project.layers.find(layer => layer.id === 'upper')!
    const preview = createMapPropertyPreview(base, state.projectEpoch)
    try {
      if (!preview.update({ ...base, opacity: 0.3 })) throw new Error('Expected property preview')
      const native = getMapRuntime()!.registry.getVector('upper')!
      const feature = native.getSource()!.getFeatures().find(feature => feature.get('value') === 1)!
      const result = native.getStyleFunction()!(feature, getMapRuntime()!.getMap().getView().getResolution()!)
      const style = Array.isArray(result) ? result[0] : result
      if ((style?.getImage() as unknown as { getRadius(): number }).getRadius() !== 9) throw new Error('Property preview replaced the standard expression')
    } finally { preview.dispose() }
  })
  await expect.poll(() => nativeState(page)).toEqual(expected)
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/features/scene/project-scene-controller.ts').at(-1)
    const { createProjectSceneController } = await import(moduleUrl ?? '/src/features/scene/project-scene-controller.ts') as typeof import('../src/features/scene/project-scene-controller')
    const controller = createProjectSceneController()
    try { controller.removeNode('upper') } finally { controller.dispose() }
  })
  await expect(page.locator('.layer-name-button')).toHaveCount(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => nativeState(page)).toEqual(expected)
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const path = info.outputPath('standard.webgis.json')
  await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  expect(saved.project.version).toBe(2)
  expect(saved.project.cartography).toEqual(drawing)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const reopen = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await reopen).setFiles(path)
  await expect.poll(() => nativeState(page)).toEqual(expected)
  expect(errors).toEqual([])
})
