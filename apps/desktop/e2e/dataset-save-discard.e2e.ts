import { expect, test } from '@playwright/test'

test('data tab discard restores one source and browser save stays pending', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { layerContentCommands } = await import(active('/src/commands/layer-content.commands.ts'))
    const { featureCommands } = await import(active('/src/commands/feature.commands.ts'))
    const { layerConfigurationCommands } = await import(active('/src/commands/layer-configuration.commands.ts'))
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    layerContentCommands.addLayer('a', 'Alpha', [{ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }], 'point')
    layerContentCommands.addLayer('b', 'Beta', [{ id: 'row', geometry: { type: 'Point', coordinates: [1, 1] }, properties: { value: 1 } }], 'point')
    const layers = useProjectStore.getState().project.content.kind === 'map2d' ? useProjectStore.getState().project.content.layers : []
    const alpha = layers.find(layer => layer.datasetId === 'a')!
    layerConfigurationCommands.renameLayer(alpha.id, 'Alpha renamed')
    featureCommands.updateProperties(alpha.id, 'row', { value: 9 })
    featureCommands.updateProperties(layers.find(layer => layer.datasetId === 'b')!.id, 'row', { value: 8 })
  })
  await expect(page.getByTitle('有未提交的数据编辑').first()).toBeVisible()
  await page.locator('.layer-name-button', { hasText: 'Alpha renamed' }).click()
  await page.getByRole('tab', { name: '数据' }).click()
  const panel = page.getByRole('tabpanel', { name: '数据' })
  await expect(panel.getByRole('button', { name: '放弃数据' })).toBeEnabled()
  await panel.getByRole('button', { name: '放弃数据' }).click()
  await expect.poll(async () => page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { featureData } = await import(active('/src/project/datasets/feature-data.ts'))
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    const project = useProjectStore.getState().project
    return {
      a: featureData.getById('a', 'row')?.properties.value,
      b: featureData.getById('b', 'row')?.properties.value,
      pendingA: featureData.pendingCount('a'),
      pendingB: featureData.pendingCount('b'),
      name: project.content.kind === 'map2d' ? project.content.layers.find(layer => layer.datasetId === 'a')?.name : null
    }
  })).toEqual({ a: 1, b: 8, pendingA: 0, pendingB: 1, name: 'Alpha renamed' })
  await page.locator('.layer-name-button', { hasText: 'Beta' }).click()
  await panel.getByRole('button', { name: '保存数据' }).click()
  await expect(page.locator('.status-message')).toContainText('浏览器不能写入本地数据文件')
  await expect.poll(async () => page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { featureData } = await import(active('/src/project/datasets/feature-data.ts'))
    return featureData.pendingCount('b')
  })).toBe(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { featureData } = await import(active('/src/project/datasets/feature-data.ts'))
    return featureData.getById('b', 'row')?.properties.value
  })).toBe(1)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    const project = useProjectStore.getState().project
    return project.content.kind === 'map2d' ? project.content.layers.find(layer => layer.datasetId === 'a')?.name : null
  })).toBe('Alpha')
  expect(errors).toEqual([])
})
