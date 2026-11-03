import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

test('field management validates names, preserves typed values and round trips atomic reference edits', async ({ page }, info) => {
  await page.route('**/*tile.openstreetmap.org/**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'schema.geojson', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [2, 4].map((value, index) => ({
      type: 'Feature', id: `row-${index}`, properties: { value, code: '001' }, geometry: { type: 'Point', coordinates: [116 + index, 39] }
    })) })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const panel = page.locator('.attribute-table-tab-panel:not([hidden])')
  await panel.getByRole('button', { name: '字段列表', exact: true }).click()
  await expect(panel.getByRole('button', { name: '新增字段', exact: true })).toBeDisabled()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  await panel.getByRole('button', { name: '新增字段', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: '新增字段', exact: true })
  await dialog.getByLabel('字段名称').fill('externalId')
  await dialog.getByLabel('允许空值', { exact: true }).uncheck()
  await dialog.getByLabel('新增字段默认值').fill('0007')
  await dialog.getByRole('button', { name: '应用字段修改', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByRole('columnheader', { name: 'externalId', exact: true })).toBeVisible()
  await expect(panel.locator('tbody')).toContainText('0007')

  await panel.getByRole('columnheader', { name: 'value', exact: true }).click()
  await panel.getByRole('button', { name: /^图层过滤/ }).click()
  const filter = panel.getByLabel('图层字段过滤')
  await filter.getByLabel('过滤字段').click()
  await page.locator('.ant-select-dropdown .ant-select-item-option-content').getByText('value', { exact: true }).click()
  await filter.getByLabel('过滤值').fill('2')
  await filter.getByRole('button', { name: '添加条件', exact: true }).click()
  await filter.getByRole('button', { name: '应用过滤', exact: true }).click()
  await expect(panel.getByLabel('表格状态与分页')).toContainText('过滤后 1')
  await panel.getByRole('button', { name: '字段列表', exact: true }).click()
  await panel.getByRole('button', { name: '重命名字段 value', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '重命名字段', exact: true })
  await dialog.getByLabel('字段名称').fill('code')
  await dialog.getByRole('button', { name: '应用字段修改', exact: true }).click()
  await expect(dialog.getByText('字段 code 已存在', { exact: true })).toBeVisible()
  await dialog.getByLabel('字段名称').fill('population')
  await page.screenshot({ path: info.outputPath('field-rename.png') })
  await dialog.getByRole('button', { name: '应用字段修改', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByRole('columnheader', { name: /^population/ })).toHaveAttribute('aria-sort', 'ascending')
  await expect(panel.getByLabel('表格状态与分页')).toContainText('过滤后 1')

  await panel.getByRole('button', { name: '删除字段 population', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '删除字段', exact: true })
  await dialog.getByRole('button', { name: '删除字段及数据', exact: true }).click()
  await expect(dialog.getByText(/字段仍被引用/)).toBeVisible()
  await dialog.getByRole('checkbox', { name: /^同时移除过滤/ }).check()
  await dialog.getByRole('button', { name: '删除字段及数据', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByRole('columnheader', { name: /^population/ })).toHaveCount(0)
  await expect(panel.getByLabel('表格状态与分页')).toContainText('过滤后 2')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(panel.getByRole('columnheader', { name: /^population/ })).toBeVisible()
  await expect(panel.getByLabel('表格状态与分页')).toContainText('过滤后 1')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const path = info.outputPath('fields.webgis.json')
  await (await download).saveAs(path)
  const saved = JSON.parse(readFileSync(path, 'utf8'))
  expect(saved.project.content.datasets[0].fields).toContainEqual({ name: 'externalId', type: 'string', nullable: false })
  expect(saved.project.content.layers[0].filter[0].field).toBe('population')
  expect(Object.values(saved.featuresByDataset)[0]).toEqual(expect.arrayContaining([
    expect.objectContaining({ properties: { population: 2, code: '001', externalId: '0007' } }),
    expect.objectContaining({ properties: { population: 4, code: '001', externalId: '0007' } })]))
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await chooser).setFiles(path)
  await page.locator('.layer-name-button').filter({ hasText: /^schema$/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await expect(panel.getByRole('columnheader', { name: /^population/ })).toBeVisible()
  await expect(panel.locator('tbody')).toContainText('0007')
  await page.screenshot({ path: info.outputPath('field-schema.png') })
})


test('typed empty GeoJSON columns survive the real worker import and appear in the table', async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  const fields = [{ name: 'code', type: 'string', nullable: true }, { name: 'height', type: 'number', nullable: false }]
  await page.locator('input[type=file]').setInputFiles({ name: 'typed-empty.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', features: [], 'webgis:schema': { version: 1, fields }
  })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.locator('.layer-name-button').filter({ hasText: 'typed-empty' }).click()
  const result = await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { featureData } = await import(active('/src/data/feature-data.ts'))
    const project = useProjectStore.getState().project, dataset = project.content.datasets.find(dataset => dataset.name === 'typed-empty')!
    return { fields: dataset.fields, source: await featureData.readSourceFields(dataset.id), effective: featureData.getEffectiveFields(dataset.id),
      rows: featureData.getAll(dataset.id), pending: featureData.pendingCount(dataset.id) }
  })
  expect(result).toEqual({ fields, source: fields, effective: fields, rows: [], pending: 0 })
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const panel = page.locator('.attribute-table-tab-panel:not([hidden])')
  await expect(panel.getByRole('columnheader', { name: /code/ })).toBeVisible()
  await expect(panel.getByRole('columnheader', { name: /height/ })).toBeVisible()
})


test('managed GeoJSON preserves stable IDs and original provenance through the real import worker', async ({ page }) => {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  const fields = [{ name: 'code', type: 'string', nullable: false }]
  const metadata = { sourceId: 42, overlaySourceId: 'origin', sourceCrs: 'EPSG:3857', importId: 'original-import' }
  await page.locator('input[type=file]').setInputFiles({ name: 'managed.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', 'webgis:dataset': { version: 1, coordinateCrs: 'EPSG:4326' }, 'webgis:schema': { version: 1, fields },
    features: [{ type: 'Feature', id: 'stable-id', geometry: { type: 'Point', coordinates: [116.4, 39.9, 7] }, properties: { code: '001' }, 'webgis:metadata': metadata }]
  })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  const result = await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { featureData } = await import(active('/src/data/feature-data.ts'))
    const dataset = useProjectStore.getState().project.content.datasets.find(dataset => dataset.name === 'managed')!
    return { fields: dataset.fields, source: await featureData.readSource(dataset.id), effective: featureData.getAll(dataset.id), pending: featureData.pendingCount(dataset.id) }
  })
  expect(result.fields).toEqual(fields)
  expect(result.source).toEqual([{ id: 'stable-id', geometry: { type: 'Point', coordinates: [116.4, 39.9, 7] }, properties: { code: '001' }, metadata }])
  expect(result.effective).toEqual(result.source); expect(result.pending).toBe(0)
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const panel = page.locator('.attribute-table-tab-panel:not([hidden])')
  await expect(panel.getByRole('columnheader', { name: 'code', exact: true })).toBeVisible()
  await expect(panel.locator('tbody')).toContainText('001')
})

test('field-add commit retains typed values and independent configuration undo', async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'field-add.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', features: [{ type: 'Feature', id: 'one', geometry: { type: 'Point', coordinates: [116, 39] }, properties: { value: 1 } }],
    'webgis:schema': { version: 1, fields: [{ name: 'value', type: 'number', nullable: false }] }
  })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { projectEdits } = await import(active('/src/session/project-edits.ts'))
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { layerConfigurationCommands } = await import(active('/src/commands/layer-configuration.commands.ts'))
    projectEdits.clear()
    layerConfigurationCommands.renameLayer(useProjectStore.getState().project.content.layers[0].id, 'Config kept')
  })
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const panel = page.locator('.attribute-table-tab-panel:not([hidden])')
  await panel.getByRole('button', { name: '开始属性编辑', exact: true }).click()
  await panel.getByRole('button', { name: '列显示与字段管理', exact: true }).click()
  await panel.getByRole('button', { name: '新增字段', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '新增字段', exact: true })
  await dialog.getByLabel('字段名称').fill('externalId')
  await dialog.getByLabel('允许空值', { exact: true }).uncheck()
  await dialog.getByLabel('新增字段默认值').fill('0007')
  await dialog.getByRole('button', { name: '应用字段修改', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const result = await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { commitDatasetEdits } = await import(active('/src/session/data-save.ts'))
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { featureData } = await import(active('/src/data/feature-data.ts'))
    const id = useProjectStore.getState().project.content.datasets[0].id
    let captured: unknown
    await commitDatasetEdits(id, async (features, _signal, fields) => { captured = { features: structuredClone(features), fields: structuredClone(fields) } })
    return { captured, source: await featureData.readSource(id), fields: await featureData.readSourceFields(id), pending: featureData.pendingCount(id) }
  })
  expect(result).toMatchObject({ captured: { features: [{ properties: { value: 1, externalId: '0007' } }] },
    source: [{ properties: { value: 1, externalId: '0007' } }], pending: 0 })
  expect(result.fields).toContainEqual({ name: 'externalId', type: 'string', nullable: false })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.layer-name-button')).toContainText('field-add')
  await expect(panel.getByRole('columnheader', { name: 'externalId', exact: true })).toBeVisible()
  await expect(panel.locator('tbody')).toContainText('0007')
})
