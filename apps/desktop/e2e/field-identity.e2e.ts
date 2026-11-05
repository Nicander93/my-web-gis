import { expect, test, type Page } from '@playwright/test'

async function state(page: Page) {
  return page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    const { featureData } = await import(active('/src/project/datasets/feature-data.ts'))
    const { getMapRuntime } = await import(active('/src/engine-host/map-runtime-host.ts'))
    const layer = useProjectStore.getState().project.content.layers[0]
    const feature = getMapRuntime()?.registry.getVector(layer.id)?.getSource()?.getFeatures()[0]
    return {
      identities: Object.fromEntries(featureData.getFieldNamespace(layer.datasetId)!.fields),
      properties: featureData.getAll(layer.datasetId)[0]?.properties,
      filter: layer.filter,
      rendered: { left: feature?.get('left'), right: feature?.get('right') },
      pending: featureData.pendingCount(layer.datasetId)
    }
  })
}

test('field identities distinguish a deleted column from another column renamed to its name through UI history', async ({ page }) => {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'identity.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', features: [{ type: 'Feature', id: 'one', properties: { left: 1, right: 2 }, geometry: { type: 'Point', coordinates: [116, 39] } }]
  })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    const { layerConfigurationCommands } = await import(active('/src/commands/layer-configuration.commands.ts'))
    layerConfigurationCommands.setLayerFilter(useProjectStore.getState().project.content.layers[0].id, [{ field: 'left', op: 'gt', value: 0 }])
  })
  const original = await state(page)
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const panel = page.locator('.attribute-table-tab-panel:not([hidden])')
  await panel.getByRole('button', { name: '开始属性编辑', exact: true }).click()
  await panel.getByRole('button', { name: '列显示与字段管理', exact: true }).click()
  await panel.getByRole('button', { name: '删除字段 right', exact: true }).click()
  await page.getByRole('dialog', { name: '删除字段', exact: true }).getByRole('button', { name: '删除字段及数据', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await panel.getByRole('button', { name: '重命名字段 left', exact: true }).click()
  const rename = page.getByRole('dialog', { name: '重命名字段', exact: true })
  await rename.getByLabel('字段名称').fill('right')
  await rename.getByRole('button', { name: '应用字段修改', exact: true }).click()
  await expect(rename).toHaveCount(0)
  await expect.poll(async () => (await state(page)).rendered).toEqual({ left: undefined, right: 1 })
  expect(await state(page)).toMatchObject({ identities: { right: original.identities.left }, properties: { right: 1 }, filter: [{ field: 'right', op: 'gt', value: 0 }] })
  expect(Object.values((await state(page)).identities)).not.toContain(original.identities.right)
  await expect(panel.getByRole('columnheader', { name: 'left', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).rendered).toEqual({ left: 1, right: 2 })
  expect(await state(page)).toMatchObject({ identities: original.identities, properties: { left: 1, right: 2 }, filter: original.filter, pending: 0 })
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await state(page)).rendered).toEqual({ left: undefined, right: 1 })
  expect((await state(page)).identities).toEqual({ right: original.identities.left })
  const committed = await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { commitDatasetEdits } = await import(active('/src/project/data-save.ts'))
    const { featureData } = await import(active('/src/project/datasets/feature-data.ts'))
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    const datasetId = useProjectStore.getState().project.content.layers[0].datasetId
    let captured: unknown
    const saved = await commitDatasetEdits(datasetId, async (features, _signal, fields) => { captured = structuredClone({ features, fields }) })
    return { saved, captured, source: await featureData.readSource(datasetId), pending: featureData.pendingCount(datasetId) }
  })
  expect(committed).toMatchObject({ saved: true, pending: 0, source: [{ properties: { right: 1 } }],
    captured: { features: [{ properties: { right: 1 } }], fields: [{ name: 'right', type: 'number' }] } })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  expect(await state(page)).toMatchObject({ filter: [], properties: { right: 1 }, pending: 0 })
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(await state(page)).toMatchObject({ filter: [{ field: 'right', op: 'gt', value: 0 }], properties: { right: 1 }, pending: 0 })
  await expect.poll(async () => (await state(page)).rendered).toEqual({ left: undefined, right: 1 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toHaveCount(0)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toHaveCount(1)
  await expect.poll(async () => (await state(page)).rendered).toEqual({ left: undefined, right: 1 })
  expect(await state(page)).toMatchObject({ identities: { right: original.identities.left }, properties: { right: 1 }, pending: 0 })
  await page.getByRole('button', { name: '重做', exact: true }).click()
  expect(await state(page)).toMatchObject({ filter: [{ field: 'right', op: 'gt', value: 0 }], properties: { right: 1 }, pending: 0 })
})
