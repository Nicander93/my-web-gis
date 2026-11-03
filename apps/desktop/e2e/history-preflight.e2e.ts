import { expect, test, type Page } from '@playwright/test'

async function state(page: Page) {
  return page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { featureData } = await import(active('/src/data/feature-data.ts'))
    const { projectEdits } = await import(active('/src/session/project-edits.ts'))
    const { getMapRuntime } = await import(active('/src/runtime/map-runtime-host.ts'))
    const project = useProjectStore.getState().project, layer = project.content.layers[0], runtime = getMapRuntime()
    const source = runtime?.registry.getVector(layer.id)?.getSource(), geometry = source?.getFeatures()[0]?.getGeometry()
    const feature = source?.getFeatures()[0]
    const styles = feature ? runtime?.registry.getVector(layer.id)?.getStyleFunction()?.(feature, runtime.getMap().getView().getResolution()!) : undefined
    const style = Array.isArray(styles) ? styles[0] : styles
    const original = (await featureData.readSource('data'))[0]
    return { crs: project.content.crs, value: featureData.getById('data', 'row')?.properties.value,
      sourceValue: original?.properties.value, pending: featureData.pendingCount('data'),
      publishedPending: featureData.getEditState().pendingCount, saving: featureData.getEditState().saving,
      count: featureData.getById('data', 'row')?.properties.count, sourceCount: original?.properties.count,
      nativeCount: source?.getFeatures()[0]?.get('count'), fields: featureData.getEffectiveFields('data'),
      nativeRadius: style?.getImage()?.getRadius?.(),
      nativeValue: source?.getFeatures()[0]?.get('value'),
      coordinates: featureData.getById('data', 'row')?.geometry.coordinates, dataRevision: featureData.revision,
      nativeProjection: runtime?.getMap().getView().getProjection().getCode(), nativeCoordinates: geometry?.getCoordinates(),
      history: projectEdits.getState(), undoBlock: projectEdits.getBlockReason('undo') }
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { layerContentCommands } = await import(active('/src/commands/layer-content.commands.ts'))
    layerContentCommands.addLayer('data', 'Data', [{ id: 'row', properties: { value: 1 }, geometry: { type: 'Point', coordinates: [116.4, 39.9] } }], 'point')
  })
})

test('toolbar undo reports a current lock without consuming history, then succeeds after unlock', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { layerConfigurationCommands } = await import(active('/src/commands/layer-configuration.commands.ts'))
    const { featureCommands } = await import(active('/src/commands/feature.commands.ts'))
    const { projectEdits } = await import(active('/src/session/project-edits.ts'))
    const id = useProjectStore.getState().project.content.layers[0].id
    layerConfigurationCommands.createGroup('Group', [id]); projectEdits.clear()
    featureCommands.updateProperties(id, 'row', { value: 2 })
  })
  async function externalLock(locked: boolean) {
    await page.evaluate(async locked => {
      const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
        .filter(name => new URL(name).pathname === path).at(-1) ?? path
      const { useProjectStore, commitProjectConfiguration } = await import(active('/src/session/project.store.ts'))
      const project = structuredClone(useProjectStore.getState().project)
      project.content.groups[0].locked = locked
      commitProjectConfiguration(project)
    }, locked)
  }
  await externalLock(true)
  await expect.poll(async () => (await state(page)).nativeValue).toBe(2)
  const before = await state(page)
  expect(before).toMatchObject({ sourceValue: 1, pending: 1 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.status-message')).toContainText('锁定')
  const blocked = await state(page)
  expect(blocked.history).toEqual(before.history)
  expect(blocked.dataRevision).toBe(before.dataRevision); expect(blocked.value).toBe(2)
  await externalLock(false)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).value).toBe(1)
  expect(await state(page)).toMatchObject({ sourceValue: 1, pending: 0 })
  expect((await state(page)).history).toMatchObject({ canUndo: false, canRedo: true })
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await state(page)).value).toBe(2)
  expect(await state(page)).toMatchObject({ sourceValue: 1, pending: 1 })
  expect(errors).toEqual([])
})

test('public root moves preserve locked siblings and update the tree and actual OL drawing order', async ({ page }) => {
  const moved = await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { layerContentCommands } = await import(active('/src/commands/layer-content.commands.ts'))
    const { layerConfigurationCommands } = await import(active('/src/commands/layer-configuration.commands.ts'))
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { createProjectSceneController } = await import(active('/src/runtime/project-scene-controller.ts'))
    layerContentCommands.addLayer('other', 'Other', [], 'point')
    const project = useProjectStore.getState().project, ids = project.content.rootOrder.map(entry => entry.id)
    layerConfigurationCommands.setLayerLocked(ids[0], true)
    const controller = createProjectSceneController()
    try { controller.moveNode(ids[1], controller.getDocument().nodes.length - 1) }
    finally { controller.dispose() }
    return { id: ids[1], sibling: ids[0], name: project.content.layers.find(layer => layer.id === ids[1])!.name }
  })
  await expect(page.locator('.layer-name-button').first()).toContainText(moved.name)
  await expect.poll(async () => page.evaluate(async ({ id, sibling }) => {
    const path = '/src/runtime/map-runtime-host.ts'
    const url = performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { getMapRuntime } = await import(url), runtime = getMapRuntime()
    const layers: unknown[] = []
    function visit(layer: { getLayers?: () => { getArray(): unknown[] } }) {
      layers.push(layer)
      for (const child of layer.getLayers?.().getArray() ?? []) visit(child as typeof layer)
    }
    for (const layer of runtime?.getMap().getLayers().getArray() ?? []) visit(layer)
    const movedIndex = layers.indexOf(runtime?.registry.getVector(id)), siblingIndex = layers.indexOf(runtime?.registry.getVector(sibling))
    return siblingIndex >= 0 && movedIndex > siblingIndex
  }, moved)).toBe(true)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.layer-name-button').first()).not.toContainText(moved.name)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(page.locator('.layer-name-button').first()).toContainText(moved.name)
})

test('projection control reprojects the actual OL source while preserving dataset coordinates and revision', async ({ page }) => {
  await expect.poll(async () => (await state(page)).nativeCoordinates?.[0] > 1e7).toBe(true)
  const before = await state(page)
  await page.getByRole('combobox', { name: '地图视图投影', exact: true }).selectOption('EPSG:4326')
  await expect.poll(async () => (await state(page)).nativeProjection).toBe('EPSG:4326')
  await expect.poll(async () => Math.abs((await state(page)).nativeCoordinates?.[0] - 116.4) < 1e-6).toBe(true)
  const projected = await state(page)
  expect(projected.crs).toBe('EPSG:4326'); expect(projected.dataRevision).toBe(before.dataRevision)
  expect(projected.coordinates).toEqual(before.coordinates)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).nativeProjection).toBe('EPSG:3857')
  await expect.poll(async () => (await state(page)).nativeCoordinates?.[0] > 1e7).toBe(true)
  const restored = await state(page)
  expect(restored.crs).toBe(before.crs); expect(restored.coordinates).toEqual(before.coordinates)
  expect(restored.dataRevision).toBe(before.dataRevision)
})

test('project replacement undo restores the original Provider and pending overlay in the actual map', async ({ page }) => {
  await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { featureCommands } = await import(active('/src/commands/feature.commands.ts'))
    const { projectSession } = await import(active('/src/session/project-session.ts'))
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const id = useProjectStore.getState().project.content.layers[0].id
    featureCommands.updateProperties(id, 'row', { value: 9 })
    const replacement = projectSession.getSnapshot()
    replacement.project.metadata.id = 'replacement'
    replacement.featuresByDataset.data[0].properties.value = 20
    projectSession.replaceSnapshotAsEdit(replacement, 'Replace project')
  })
  await expect.poll(async () => (await state(page)).nativeValue).toBe(20)
  expect(await state(page)).toMatchObject({ value: 20, sourceValue: 20, pending: 0 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).nativeValue).toBe(9)
  expect(await state(page)).toMatchObject({ value: 9, sourceValue: 1, pending: 1 })
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await state(page)).nativeValue).toBe(20)
  expect(await state(page)).toMatchObject({ value: 20, sourceValue: 20, pending: 0 })
})

test('mixed snapshot data commit retains configuration undo and the actual map keeps committed rows', async ({ page }) => {
  const persisted = await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { projectSession } = await import(active('/src/session/project-session.ts'))
    const { commitDatasetEdits } = await import(active('/src/session/data-save.ts'))
    const snapshot = projectSession.getSnapshot()
    snapshot.project.content.layers[0].name = 'Saved name'
    snapshot.featuresByDataset.data[0].properties.value = 9
    projectSession.applySnapshotAsEdit(snapshot, 'Mixed edit')
    let captured: unknown
    await commitDatasetEdits('data', async rows => { captured = structuredClone(rows) })
    return captured
  })
  expect(persisted).toMatchObject([{ id: 'row', properties: { value: 9 } }])
  await expect.poll(async () => (await state(page)).nativeValue).toBe(9)
  expect(await state(page)).toMatchObject({ value: 9, sourceValue: 9, pending: 0 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.layer-name-button').first()).toContainText('Data')
  expect(await state(page)).toMatchObject({ value: 9, nativeValue: 9, sourceValue: 9, pending: 0 })
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(page.locator('.layer-name-button').first()).toContainText('Saved name')
  expect(await state(page)).toMatchObject({ value: 9, sourceValue: 9, pending: 0 })
})

test('historical advanced style dependency retires after field deletion without blocking commit or reverting data', async ({ page }) => {
  await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { layerConfigurationCommands } = await import(active('/src/commands/layer-configuration.commands.ts'))
    const project = useProjectStore.getState().project, layer = project.content.layers[0]
    const binding = project.content.cartography.bindings.find(item => item.gisLayerId === layer.id)!
    const styles = structuredClone(project.content.cartography.styleLayers.filter(style => binding.styleLayerIds.includes(style.id)))
    const circle = styles.find(style => style.type === 'circle')!
    circle.paint = { ...circle.paint, 'circle-radius': ['get', 'value'], 'circle-opacity': 0.4 }
    layerConfigurationCommands.setLayerCartography(layer.id, styles)
    circle.paint['circle-radius'] = 4
    layerConfigurationCommands.setLayerCartography(layer.id, styles)
  })
  await expect.poll(async () => (await state(page)).nativeRadius).toBe(4)
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  const panel = page.locator('.attribute-table-tab-panel:not([hidden])')
  await panel.getByRole('button', { name: '开始属性编辑', exact: true }).click()
  await panel.getByRole('button', { name: '列显示与字段管理', exact: true }).click()
  await panel.getByRole('button', { name: '删除字段 value', exact: true }).click()
  await page.getByRole('dialog', { name: '删除字段', exact: true }).getByRole('button', { name: '删除字段及数据', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { commitDatasetEdits } = await import(active('/src/session/data-save.ts'))
    await commitDatasetEdits('data', async () => {})
  })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).nativeRadius).toBe(5)
  expect(await state(page)).toMatchObject({ fields: [], pending: 0 })
  expect((await state(page)).value).toBeUndefined(); expect((await state(page)).sourceValue).toBeUndefined()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await state(page)).nativeRadius).toBe(4)
  expect(await state(page)).toMatchObject({ fields: [], pending: 0 })
})

test('resource schema commit restores the other project pending edits and replays the committed map source', async ({ page }) => {
  await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { projectSession } = await import(active('/src/session/project-session.ts'))
    const { featureCommands } = await import(active('/src/commands/feature.commands.ts'))
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { commitDatasetEdits } = await import(active('/src/session/data-save.ts'))
    featureCommands.updateProperties(useProjectStore.getState().project.content.layers[0].id, 'row', { value: 9 })
    const other = projectSession.getSnapshot()
    other.project.metadata.id = 'schema-project-b'
    other.featuresByDataset.data[0].properties.value = 20
    projectSession.replaceSnapshotAsEdit(other, 'Project B')
    const changed = projectSession.getSnapshot()
    changed.project.content.datasets[0].fields = [{ name: 'count', type: 'number', nullable: false }]
    changed.featuresByDataset.data[0].properties = { count: 30 }
    projectSession.applySnapshotAsEdit(changed, 'B schema')
    await commitDatasetEdits('data', async () => {})
  })
  await expect.poll(async () => (await state(page)).nativeCount).toBe(30)
  expect(await state(page)).toMatchObject({ count: 30, sourceCount: 30, pending: 0, publishedPending: 0, saving: false })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).nativeValue).toBe(9)
  expect(await state(page)).toMatchObject({ value: 9, sourceValue: 1, pending: 1 })
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await state(page)).nativeValue).toBe(1)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await state(page)).nativeValue).toBe(9)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await state(page)).nativeCount).toBe(30)
  expect(await state(page)).toMatchObject({ count: 30, sourceCount: 30, pending: 0, fields: [{ name: 'count', type: 'number', nullable: false }] })
  expect((await state(page)).value).toBeUndefined()
})

test('mixed schema snapshot commit retains configuration undo while the actual map keeps the new field', async ({ page }) => {
  const captured = await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { projectSession } = await import(active('/src/session/project-session.ts'))
    const { commitDatasetEdits } = await import(active('/src/session/data-save.ts'))
    const snapshot = projectSession.getSnapshot()
    snapshot.project.content.layers[0].name = 'Schema name'
    snapshot.project.content.datasets[0].fields = [{ name: 'count', type: 'number', nullable: false }]
    snapshot.featuresByDataset.data[0].properties = { count: 9 }
    projectSession.applySnapshotAsEdit(snapshot, 'Mixed schema')
    let captured: unknown
    await commitDatasetEdits('data', async (features, _signal, fields) => { captured = structuredClone({ features, fields }) })
    return captured
  })
  expect(captured).toMatchObject({ features: [{ properties: { count: 9 } }], fields: [{ name: 'count', type: 'number', nullable: false }] })
  await expect.poll(async () => (await state(page)).nativeCount).toBe(9)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.locator('.layer-name-button').first()).toContainText('Data')
  expect(await state(page)).toMatchObject({ count: 9, sourceCount: 9, nativeCount: 9, pending: 0,
    fields: [{ name: 'count', type: 'number', nullable: false }] })
  expect((await state(page)).value).toBeUndefined()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(page.locator('.layer-name-button').first()).toContainText('Schema name')
  expect(await state(page)).toMatchObject({ count: 9, sourceCount: 9, nativeCount: 9, pending: 0 })
})

test('public local locks end map editing and the context menu unlocks them without touching rows', async ({ page }) => {
  await expect.poll(async () => (await state(page)).nativeCoordinates?.[0] > 1e7).toBe(true)
  const before = await state(page), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const result = await page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { useWorkbenchStore } = await import(active('/src/view-state/workbench.store.ts'))
    const { editCommands } = await import(active('/src/commands/edit.commands.ts'))
    const { featureCommands } = await import(active('/src/commands/feature.commands.ts'))
    const { createProjectSceneController } = await import(active('/src/runtime/project-scene-controller.ts'))
    const id = useProjectStore.getState().project.content.layers[0].id, controller = createProjectSceneController()
    const began = editCommands.beginLayer(id)
    try {
      controller.setNodeLocked(id, true)
      return { began, editLayerId: useWorkbenchStore.getState().editLayerId,
        write: featureCommands.updateProperties(id, 'row', { value: 2 }),
        layer: useProjectStore.getState().project.content.layers[0] }
    } finally { controller.dispose() }
  })
  expect(result).toMatchObject({ began: true, editLayerId: null, write: false, layer: { editable: false, locked: true } })
  const row = page.locator('.layer-item').filter({ hasText: 'Data' })
  await expect(row.getByLabel('图层已锁定', { exact: true })).toBeVisible()
  await expect(row).toHaveAttribute('draggable', 'false')
  await row.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: '样式', exact: true })).toBeDisabled()
  await page.getByRole('menuitem', { name: '解锁图层', exact: true }).click()
  await expect(row.getByLabel('图层已锁定', { exact: true })).toHaveCount(0)
  await expect(row).toHaveAttribute('draggable', 'true')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(row.getByLabel('图层已锁定', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(row.getByLabel('图层已锁定', { exact: true })).toHaveCount(0)
  const after = await state(page)
  expect(after.value).toBe(before.value); expect(after.coordinates).toEqual(before.coordinates)
  expect(after.dataRevision).toBe(before.dataRevision); expect(errors).toEqual([])
})
