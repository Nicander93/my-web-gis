import { expect, test, type Page } from '@playwright/test'

test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })

test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.getByRole('region', { name: '地图工作区' })).toHaveAttribute('data-map-runtime', 'mounted')
})

async function seedLocalLayer(page: Page) {
  return page.evaluate(async () => {
    const { layerContentCommands } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/commands/layer-content.commands.ts').at(-1) ?? '/src/commands/layer-content.commands.ts')

    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname === '/src/project/project.store.ts') ?? '/src/project/project.store.ts'
    const { useProjectStore } = await import(moduleUrl)
    const store = useProjectStore.getState()
    layerContentCommands.addLayer('stations-source.geojson', '站点结果', [
      { id: 'station-a', type: 'Feature', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { name: '甲站' } },
      { id: 'station-b', type: 'Feature', geometry: { type: 'Point', coordinates: [116.01, 39] }, properties: { name: '乙站' } }
    ], 'point', {
      sourceLayerId: 'source-layer-1', sourceLayerName: '输入站点',
      options: { tool: 'buffer', distance: 3, unit: 'meters' },
      scope: 'all', inputCount: 2, outputCount: 2,
      engine: { id: 'test-processing', version: '1.0', tool: 'buffer' },
      completedAt: '2026-10-23T00:00:00.000Z'
    })
    return useProjectStore.getState().project.content.layers.at(-1)!.id
  })
}

async function seedWfsLayer(page: Page) {
  return page.evaluate(async () => {
    const { datasetConfigurationCommands } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/commands/dataset-configuration.commands.ts').at(-1) ?? '/src/commands/dataset-configuration.commands.ts')

    const { layerContentCommands } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/commands/layer-content.commands.ts').at(-1) ?? '/src/commands/layer-content.commands.ts')

    const { featureCommands } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/commands/feature.commands.ts').at(-1) ?? '/src/commands/feature.commands.ts')

    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname === '/src/project/project.store.ts') ?? '/src/project/project.store.ts'
    const { useProjectStore } = await import(moduleUrl)
    const store = useProjectStore.getState()
    const layer = layerContentCommands.addServiceLayer({
      name: 'WFS 站点快照', kind: 'wfs', source: {
        type: 'wfs', url: 'https://gis.example.test/geoserver/wfs', version: '2.0.0',
        typeName: 'demo:stations', outputFormat: 'application/json', srsName: 'EPSG:4326',
        complete: true, extentMode: 'full', paginationUsed: false,
        duplicateIdCount: 0, lastLoadedAt: '2026-10-23T00:00:00.000Z', authMode: 'none'
      }
    })
    if (!layer) throw new Error('WFS fixture could not be added')
    featureCommands.replaceDatasetFeatures(layer.datasetId, [
      { id: 'wfs-station-1', type: 'Feature', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { name: 'WFS 甲站' } }
    ])
    datasetConfigurationCommands.patchWfsServiceSource(layer.datasetId, { loadedCount: 1 })
    return layer.layerId
  })
}

async function openInspector(page: Page) {
  const rail = page.getByRole('navigation', { name: '右侧工作面板' })
  await rail.getByRole('button', { name: '属性', exact: true }).click()
  return page.getByRole('complementary', { name: '检查器面板' })
}

async function projectState(page: Page) {
  return page.evaluate(async () => {
    const { projectSession } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-session.ts').at(-1) ?? '/src/project/project-session.ts')

    const { projectEdits } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-edits.ts').at(-1) ?? '/src/project/project-edits.ts')

    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .findLast(url => new URL(url).pathname === '/src/project/project.store.ts') ?? '/src/project/project.store.ts'
    const store = (await import(moduleUrl)).useProjectStore.getState()
    return {
      snapshot: projectSession.getSnapshot(), dirty: store.dirty,
      undo: projectEdits.canUndo(), redo: projectEdits.canRedo()
    }
  })
}

test('right inspector keeps common layer actions while full properties retain local source and processing metadata', async ({ page }) => {
  await seedLocalLayer(page)
  const inspector = await openInspector(page)

  await expect(inspector.getByText('图层概览', { exact: true })).toBeVisible()
  await expect(inspector.getByText('本地矢量', { exact: true })).toBeVisible()
  await expect(inspector.getByText('本地要素 · 2 条', { exact: true })).toBeVisible()
  await expect(inspector.getByText('地图可选择', { exact: true })).toBeVisible()
  await expect(inspector.getByText('不透明度', { exact: true })).toBeVisible()
  await expect(inspector.getByRole('button', { name: '完整属性…', exact: true })).toBeVisible()
  await expect(inspector.getByText('数据源与几何', { exact: true })).toHaveCount(0)
  await expect(inspector.getByText('几何类型', { exact: true })).toHaveCount(0)
  await expect(inspector.getByText('处理来源与参数', { exact: true })).toHaveCount(0)

  const before = await projectState(page)
  await inspector.getByRole('button', { name: '完整属性…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '完整属性：站点结果', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('menuitem', { name: '数据源', exact: true }).click()
  await expect(dialog.getByText('stations-source.geojson', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Point（2）', { exact: true })).toBeVisible()
  const provenance = dialog.locator('details').filter({ hasText: '处理来源与参数' })
  await provenance.locator('summary').click()
  await expect(provenance).toContainText('输入站点')
  await expect(provenance).toContainText('缓冲区')
  expect(await projectState(page)).toEqual(before)
})

test('WFS protocol and readonly snapshot details remain reachable without changing project history', async ({ page }) => {
  await seedWfsLayer(page)
  const inspector = await openInspector(page)
  await expect(inspector.getByText('WFS 只读快照', { exact: true })).toBeVisible()
  await expect(inspector.getByText('只读快照 · 1 条', { exact: true })).toBeVisible()
  await expect(inspector.getByRole('button', { name: '完整属性…', exact: true })).toBeVisible()
  await expect(inspector.getByRole('button', { name: '开始属性编辑', exact: true })).toHaveCount(0)

  const before = await projectState(page)
  await inspector.getByRole('button', { name: '完整属性…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '完整属性：WFS 站点快照', exact: true })
  await dialog.getByRole('menuitem', { name: '数据源', exact: true }).click()
  await expect(dialog.getByText('https://gis.example.test/geoserver/wfs', { exact: true })).toBeVisible()
  await expect(dialog.getByText('2.0.0', { exact: true })).toBeVisible()
  await expect(dialog.getByText('demo:stations', { exact: true })).toBeVisible()
  await expect(dialog.getByText('application/json', { exact: true })).toBeVisible()
  await expect(dialog.getByText('只读快照，不执行 WFS-T；需要编辑时请复制为本地图层', { exact: true })).toBeVisible()
  expect(await projectState(page)).toEqual(before)
})
