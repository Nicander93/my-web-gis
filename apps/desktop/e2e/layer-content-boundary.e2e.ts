import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function contentState(page: Page, firstId: string) {
  return page.evaluate(async firstId => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    const { featureData } = await import(active('/src/project/datasets/feature-data.ts'))
    const { getMapRuntime } = await import(active('/src/engine-host/map-runtime-host.ts'))
    const current = useProjectStore.getState(), runtime = getMapRuntime()
    return { layerIds: current.project.content.layers.map(layer => layer.id), datasetIds: current.project.content.datasets.map(dataset => dataset.id),
      rowIds: featureData.getAll('shared').map(row => row.id), dataRevision: featureData.revision,
      firstRuntime: runtime?.registry.getVector(firstId)?.getSource()?.getFeatures().length ?? null,
      siblingRuntime: runtime?.registry.getVector('sibling')?.getSource()?.getFeatures().length ?? null }
  }, firstId)
}

test('UI layer deletion, undo, redo and save retain the dataset used by a sibling and its real map source', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  const firstId = await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { layerContentCommands } = await import(active('/src/commands/layer-content.commands.ts'))
    const { projectSession } = await import(active('/src/project/project-session.ts'))
    layerContentCommands.addLayer('shared', 'First', [{ id: 'row', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 7 } }], 'point')
    const snapshot = projectSession.getSnapshot(), first = snapshot.project.content.layers[0]
    snapshot.project.content.layers.push({ ...structuredClone(first), id: 'sibling', name: 'Sibling' })
    snapshot.project.content.rootOrder.push({ type: 'layer', id: 'sibling' })
    projectSession.loadSnapshot(snapshot)
    return first.id
  })
  await expect.poll(async () => (await contentState(page, firstId)).firstRuntime).toBe(1)
  await expect.poll(async () => (await contentState(page, firstId)).siblingRuntime).toBe(1)
  const before = await contentState(page, firstId)
  await page.getByRole('button', { name: '更多操作 First', exact: true }).click()
  await page.getByRole('menuitem', { name: '移除', exact: true }).click()
  const removed = { layerIds: ['sibling'], datasetIds: ['shared'], rowIds: ['row'], dataRevision: before.dataRevision, firstRuntime: null, siblingRuntime: 1 }
  await expect.poll(() => contentState(page, firstId)).toEqual(removed)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => contentState(page, firstId)).toEqual(before)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(() => contentState(page, firstId)).toEqual(removed)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存项目', exact: true }).click()
  const output = info.outputPath('shared-dataset.webgis.json')
  await (await download).saveAs(output)
  const saved = JSON.parse(readFileSync(output, 'utf8'))
  expect(saved.project.content.layers.map(layer => layer.id)).toEqual(['sibling'])
  expect(saved.project.content.datasets.map(dataset => dataset.id)).toEqual(['shared'])
  expect(saved.featuresByDataset.shared.map(row => [row.id, row.properties.value])).toEqual([['row', 7]])
  expect(errors).toEqual([])
})
