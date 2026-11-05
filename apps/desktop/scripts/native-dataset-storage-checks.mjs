import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from '@playwright/test'

async function state(page) {
  return page.evaluate(async () => {
    const active = path => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    const { featureData } = await import(active('/src/project/datasets/feature-data.ts'))
    const { getMapRuntime } = await import(active('/src/engine-host/map-runtime-host.ts'))
    const project = useProjectStore.getState().project, layer = project.content.layers[0]
    return { source: await featureData.readSource('data'), rows: featureData.getAll('data'), pending: featureData.pendingCount('data'),
      publishedPending: featureData.getEditState().pendingCount, saving: featureData.getEditState().saving,
      storage: project.content.datasets[0]?.storage, nativeValue: getMapRuntime()?.registry.getVector(layer.id)?.getSource()?.getFeatures()[0]?.get('value') }
  })
}

/** Assigned owned fixture paths exercise real native file IPC; no OS chooser or screenshots. */
export async function verifyNativeDatasetStorage(page, report, output, saveTo, restart) {
  const target = join(output, '受管数据.geojson'), projectPath = join(output, '引用工程.webgis.json')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  const created = await page.evaluate(async path => {
    const active = path => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { layerContentCommands } = await import(active('/src/commands/layer-content.commands.ts'))
    const { featureCommands } = await import(active('/src/commands/feature.commands.ts'))
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    const { featureData } = await import(active('/src/project/datasets/feature-data.ts'))
    const { createDatasetStorage } = await import('/src/project/dataset-storage.ts')
    layerContentCommands.addLayer('data', 'Native managed data', [{ id: 'stable-row', geometry: { type: 'Point', coordinates: [116.4, 39.9, 7] },
      properties: { value: 1, code: '001' }, metadata: { sourceId: 42, sourceCrs: 'EPSG:3857', importId: 'native-origin' } }], 'point')
    featureCommands.updateProperties(useProjectStore.getState().project.content.layers[0].id, 'stable-row', { value: 9, code: '001' })
    await createDatasetStorage('data', path)
    return { pending: featureData.pendingCount('data'), value: featureData.getAll('data')[0].properties.value,
      publishedPending: featureData.getEditState().pendingCount, saving: featureData.getEditState().saving }
  }, target)
  assert.deepEqual(created, { pending: 1, value: 9, publishedPending: 1, saving: false })
  const initialBytes = await readFile(target, 'utf8')
  assert.equal(JSON.parse(initialBytes).features[0].properties.value, 1)
  report.scenarios.push({ name: 'Native no-clobber initialization writes original Provider data and preserves pending edits', passed: true })
  const rejected = await page.evaluate(async path => {
    try { await (await import('/src/project/dataset-storage.ts')).createDatasetStorage('data', path); return false }
    catch { return true }
  }, target)
  assert.equal(rejected, true); assert.equal(await readFile(target, 'utf8'), initialBytes)
  report.scenarios.push({ name: 'Native target creation refuses an existing file without changing its bytes', passed: true })
  const saved = await page.evaluate(async () => {
    const active = path => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    const { saveBoundDataset } = await import('/src/project/dataset-storage.ts')
    const before = useProjectStore.getState()
    const saved = await saveBoundDataset('data'), after = useProjectStore.getState()
    return { saved, sameProject: before.project === after.project, sameRevision: before.configRevision === after.configRevision, sameDirty: before.dirty === after.dirty }
  })
  assert.deepEqual(saved, { saved: true, sameProject: true, sameRevision: true, sameDirty: true })
  assert.equal(JSON.parse(await readFile(target, 'utf8')).features[0].properties.value, 9)
  await expect.poll(async () => (await state(page)).nativeValue).toBe(9)
  assert.equal((await state(page)).pending, 0)
  assert.equal((await state(page)).publishedPending, 0); assert.equal((await state(page)).saving, false)
  report.scenarios.push({ name: 'Native bound data commit publishes complete bytes and keeps configuration identity/revision/dirty unchanged', passed: true })
  // Keep current product Save semantics, then create an explicit reference-only migration fixture.
  await saveTo(projectPath)
  await page.evaluate(async path => {
    const active = path => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { projectSession } = await import(active('/src/project/project-session.ts'))
    const { saveSnapshotToPath } = await import('/src/project/project-io.ts')
    await saveSnapshotToPath(path, { project: projectSession.getSnapshot().project, featuresByDataset: {} }, path)
  }, projectPath)
  const file = JSON.parse(await readFile(projectPath, 'utf8'))
  assert.deepEqual(file.featuresByDataset, {})
  assert.deepEqual(file.project.content.datasets[0].storage.reference, { kind: 'relative', path: '受管数据.geojson' })
  page = await restart()
  await page.evaluate(async path => {
    const active = path => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { projectSession } = await import(active('/src/project/project-session.ts'))
    const io = await import('/src/project/project-io.ts')
    const loaded = await io.readSnapshotFromPath(path)
    projectSession.loadSnapshot(loaded.snapshot); io.setCurrentProjectPath(path)
  }, projectPath)
  await expect.poll(async () => (await state(page)).nativeValue).toBe(9)
  const reopened = await state(page)
  assert.equal(reopened.pending, 0)
  assert.deepEqual(reopened.source[0].metadata, { sourceId: 42, sourceCrs: 'EPSG:3857', importId: 'native-origin' })
  assert.deepEqual(reopened.rows[0].geometry.coordinates, [116.4, 39.9, 7])
  assert.equal(reopened.rows[0].properties.code, '001')
  report.scenarios.push({ name: 'Native process restart reopens relative data reference through production loader with stable ID/provenance/coordinates', passed: true })
  await page.evaluate(async () => {
    const active = path => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { featureCommands } = await import(active('/src/commands/feature.commands.ts'))
    const { useProjectStore } = await import(active('/src/project/project.store.ts'))
    featureCommands.updateProperties(useProjectStore.getState().project.content.layers[0].id, 'stable-row', { value: 12, code: '001' })
    await (await import('/src/project/dataset-storage.ts')).saveBoundDataset('data')
  })
  assert.equal(JSON.parse(await readFile(target, 'utf8')).features[0].properties.value, 12)
  await expect.poll(async () => (await state(page)).nativeValue).toBe(12)
  assert.equal((await state(page)).pending, 0)
  report.scenarios.push({ name: 'Reopened native Provider can edit and commit to the same bound file again', passed: true })
  report.datasetStorage = { target, projectPath, osPicker: false, referenceOnlyFixture: true, userDataSaveUI: false, editLifecycleMetadata: true }
}
