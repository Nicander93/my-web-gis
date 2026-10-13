import { test, expect, type Page } from '@playwright/test'

async function mapState(page: Page) {
  return page.evaluate(async () => {
    // Observe the live runtime; selection is changed only by actual mouse/keyboard input.
    const host = await import('/src/features/map/map-runtime-host.ts')
    const store = await import('/src/stores/project.store.ts')
    const state = store.useProjectStore.getState()
    const runtime = host.getMapRuntime()!
    const map = runtime.getMap()
    const layer = runtime.registry.getVector(state.selectedLayerId!)!
    const positions = layer.getSource()!.getFeatures().map(feature => ({
      id: String(feature.getId()), pixel: map.getPixelFromCoordinate(feature.getGeometry()!.getExtent().slice(0, 2))
    })).sort((a, b) => a.pixel[0] - b.pixel[0])
    return { positions, selection: state.selection.featureIds, center: map.getView().getCenter(), dirty: state.dirty, opacity: layer.getOpacity() }
  })
}

async function waitForMapResize(page: Page) {
  // OpenLayers applies a viewport resize on a later frame; pixels read before that are stale.
  await expect.poll(() => page.evaluate(async () => {
    const host = await import('/src/features/map/map-runtime-host.ts')
    const map = host.getMapRuntime()!.getMap()
    const viewport = map.getViewport()
    const size = map.getSize()
    return size?.[0] === viewport.clientWidth && size?.[1] === viewport.clientHeight
  })).toBe(true)
  await page.evaluate(async () => {
    const host = await import('/src/features/map/map-runtime-host.ts')
    const map = host.getMapRuntime()!.getMap()
    await new Promise(resolve => { map.once('rendercomplete', resolve); map.render() })
  })
}

async function drag(page: Page, from: number[], to: number[], key?: 'Shift' | 'Alt') {
  const bounds = (await page.locator('.ol-viewport').boundingBox())!
  if (key) await page.keyboard.down(key)
  await page.mouse.move(bounds.x + from[0], bounds.y + from[1])
  await page.mouse.down()
  await page.mouse.move(bounds.x + to[0], bounds.y + to[1], { steps: 12 })
  await page.mouse.up()
  if (key) await page.keyboard.up(key)
}

test.beforeEach(async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'selection.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', features: [0, 1, 2].map(index => ({ type: 'Feature', id: `point-${index}`,
      properties: { name: `Point ${index}` }, geometry: { type: 'Point', coordinates: [116.4 + index * .02, 39.9] } }))
  })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('tab', { name: '地图', exact: true }).click()
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await page.waitForTimeout(350)
  // 覆盖窗口允许遮挡地图；地图输入验收先通过真实菜单关闭树。
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '图层面板', exact: true }).click()
})

test('box selection links the accepted rows; modifiers, empty selection and row locate work', async ({ page }, info) => {
  let state = await mapState(page)
  const first = state.positions[0].pixel
  await drag(page, [first[0] - 12, first[1] - 12], [first[0] + 12, first[1] + 12])
  await expect(page.getByRole('complementary', { name: '属性表面板' })).toBeVisible()
  await expect(page.getByLabel('仅选中', { exact: true })).toBeChecked()
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await expect.poll(async () => (await mapState(page)).selection).toEqual([state.positions[0].id])
  const before = (await mapState(page)).center
  const row = page.locator('.table-scroll tbody tr').first()
  await row.locator('td').nth(2).dblclick()
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await page.waitForTimeout(250)
  expect((await mapState(page)).center).not.toEqual(before)
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await page.waitForTimeout(350)
  state = await mapState(page)
  const second = state.positions[1].pixel
  await drag(page, [second[0] - 12, second[1] - 12], [second[0] + 12, second[1] + 12], 'Shift')
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(2)
  await drag(page, [second[0] - 12, second[1] - 12], [second[0] + 12, second[1] + 12], 'Alt')
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await drag(page, [20, 20], [40, 40])
  await expect(page.getByLabel('表格状态与分页')).toContainText('选中 0')
  await expect(page.getByLabel('表格状态与分页')).toContainText('0 / 0')
  await page.screenshot({ path: info.outputPath('selection-empty.png') })
})

test('map selectable policy preserves table selection and location, and follows undo', async ({ page }, info) => {
  const initial = await mapState(page), first = initial.positions[0].pixel
  await drag(page, [first[0] - 12, first[1] - 12], [first[0] + 12, first[1] + 12])
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: '图层属性', exact: true }).click()
  const selectable = page.getByRole('checkbox', { name: '地图可选择', exact: true })
  await selectable.uncheck()
  await expect(page.getByRole('button', { name: /^当前工具说明：此图层未启用地图选择/ })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => {
    const host = await import('/src/features/map/map-runtime-host.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    return host.getMapRuntime()!.isLayerSelectable(useProjectStore.getState().selectedLayerId!)
  })).toBe(false)
  await waitForMapResize(page)
  const current = await mapState(page), second = current.positions[1].pixel
  const bounds = (await page.locator('.ol-viewport').boundingBox())!
  await page.mouse.click(bounds.x + second[0], bounds.y + second[1])
  await drag(page, [second[0] - 12, second[1] - 12], [second[0] + 12, second[1] + 12], 'Shift')
  await expect.poll(async () => (await mapState(page)).selection).toEqual([initial.positions[0].id])
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await page.getByLabel('仅选中', { exact: true }).uncheck()
  await page.screenshot({ path: info.outputPath('map-selection-disabled.png') })
  const row = page.locator('.table-scroll tbody tr').filter({ hasText: 'Point 2' })
  await row.locator('td').nth(2).click()
  await expect.poll(async () => (await mapState(page)).selection).toEqual(['point-2'])
  const before = (await mapState(page)).center
  await row.locator('td').nth(2).dblclick()
  await expect.poll(async () => (await mapState(page)).center).not.toEqual(before)
  await page.getByRole('button', { name: '撤销', exact: true }).first().click()
  await expect(selectable).toBeChecked()
  await expect(page.getByRole('button', { name: /^当前工具说明：单击或拖框选择/ })).toBeVisible()
  await expect.poll(async () => (await mapState(page)).selection).toEqual(['point-2'])
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await page.waitForTimeout(350)
  await waitForMapResize(page)
  const restored = await mapState(page), pick = restored.positions[1].pixel
  await drag(page, [pick[0] - 12, pick[1] - 12], [pick[0] + 12, pick[1] + 12])
  await expect.poll(async () => (await mapState(page)).selection).toEqual([restored.positions[1].id])
})

test('popup fields are safe, independent of map selection, and close when filtered or editing', async ({ page }, info) => {
  await page.getByRole('button', { name: '图层属性', exact: true }).click()
  await page.locator('summary').filter({ hasText: '属性弹窗' }).click()
  await page.getByRole('checkbox', { name: '弹窗显示字段 name', exact: true }).check()
  await page.getByLabel('弹窗标题字段', { exact: true }).selectOption('name')
  await waitForMapResize(page)
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await page.waitForTimeout(350)
  const clickFeature = async (index: number) => {
    await waitForMapResize(page)
    await expect.poll(() => page.evaluate(async () => {
      const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
      return getMapRuntime()!.getMap().getView().getAnimating()
    })).toBe(false)
    const state = await mapState(page), pixel = state.positions[index].pixel
    const bounds = (await page.locator('.ol-viewport').boundingBox())!
    // Wait for OL's delayed singleclick, rather than accidentally making a doubleclick.
    await page.evaluate(async () => {
      const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
      const pending = window as Window & { __popupClick?: Promise<void> }
      pending.__popupClick = new Promise(resolve => getMapRuntime()!.getMap().once('singleclick', () => resolve()))
    })
    await page.mouse.click(bounds.x + pixel[0], bounds.y + pixel[1])
    await page.evaluate(() => (window as Window & { __popupClick?: Promise<void> }).__popupClick)
  }
  const popup = page.getByRole('dialog', { name: '要素属性弹窗', exact: true })
  await clickFeature(0)
  await expect(popup).toBeVisible()
  await expect(popup.locator('strong')).toHaveText('Point 0')
  await popup.getByRole('button', { name: '关闭属性弹窗' }).focus()
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  await clickFeature(0)
  await expect(popup).toBeVisible()
  await popup.getByRole('button', { name: '关闭属性弹窗' }).click()
  await expect(popup).toBeHidden()
  await clickFeature(0)
  await expect(popup).toBeVisible()
  await page.getByRole('checkbox', { name: '弹窗显示字段 name', exact: true }).uncheck()
  await expect(popup).toBeHidden()
  await clickFeature(0)
  await expect(popup).toBeHidden()
  await page.getByRole('button', { name: '撤销', exact: true }).first().click()
  await clickFeature(0)
  await expect(popup.locator('strong')).toHaveText('Point 0')
  await page.getByRole('checkbox', { name: '地图可选择', exact: true }).uncheck()
  await clickFeature(1)
  await expect(popup.locator('strong')).toHaveText('Point 1')
  await expect.poll(async () => (await mapState(page)).selection).toEqual(['point-0'])
  await page.evaluate(async () => {
    const { createProjectSceneController } = await import('/src/features/scene/project-scene-controller.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const state = useProjectStore.getState(), controller = createProjectSceneController()
    try { controller.transaction('Popup safety fixture', draft => {
      const node = draft.nodes.find(item => item.id === state.selectedLayerId)
      if (node?.type !== 'vector') throw new Error('expected vector')
      const resource = draft.resources[node.resource]
      if (resource.type !== 'geojson' || !resource.data) throw new Error('expected local GeoJSON')
      resource.data.features[1].properties = { name: '<img src=x onerror=alert(1)>' }
    }) } finally { controller.dispose() }
  })
  await clickFeature(1)
  await expect(popup).toContainText('<img src=x onerror=alert(1)>')
  await expect(popup.locator('img')).toHaveCount(0)
  await expect.poll(async () => {
    const close = await popup.getByRole('button', { name: '关闭属性弹窗' }).boundingBox()
    const map = await page.locator('.ol-viewport').boundingBox()
    return !!close && !!map && close.x >= map.x && close.x + close.width <= map.x + map.width
  }).toBe(true)
  await page.screenshot({ path: info.outputPath('popup-safe-text.png') })
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '图层面板', exact: true }).click()
  await page.getByRole('button', { name: '隐藏selection', exact: true }).click()
  await expect(popup).toBeHidden()
  await page.getByRole('button', { name: '显示selection', exact: true }).click()
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '图层面板', exact: true }).click()
  await waitForMapResize(page)
  await clickFeature(1)
  await expect(popup).toBeVisible()
  await page.evaluate(async () => {
    const { createProjectSceneController } = await import('/src/features/scene/project-scene-controller.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const controller = createProjectSceneController()
    try { controller.transaction('Exclude popup feature', draft => {
      const node = draft.nodes.find(item => item.id === useProjectStore.getState().selectedLayerId)
      if (node?.type === 'vector') node.filter = [{ field: 'name', op: 'eq', value: 'Point 0' }]
    }) } finally { controller.dispose() }
  })
  await expect(popup).toBeHidden()
  await waitForMapResize(page)
  await page.getByRole('button', { name: '定位图层', exact: true }).click()
  await page.waitForTimeout(350)
  await clickFeature(0)
  await expect(popup).toBeVisible()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  await page.getByRole('button', { name: '绘制要素', exact: true }).click()
  await expect(popup).toBeHidden()
})

test('domestic view projections keep selection, CSV coordinates and document history consistent', async ({ page }, info) => {
  const initial = await mapState(page), pixel = initial.positions[0].pixel
  await drag(page, [pixel[0] - 12, pixel[1] - 12], [pixel[0] + 12, pixel[1] + 12])
  const picker = page.getByRole('combobox', { name: '地图视图投影', exact: true })
  await picker.selectOption('EPSG:4527')
  const read = () => page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const { createProjectSceneDocument } = await import('/src/features/scene/project-scene-document.ts')
    const state = useProjectStore.getState(), runtime = getMapRuntime()!, view = runtime.getMap().getView()
    const layer = state.project.layers.find(item => item.id === state.selectedLayerId)!
    return { code: view.getProjection().getCode(), stored: state.project.crs,
      point: runtime.registry.getVector(layer.id)!.getSource()!.getFeatureById('point-0')!.getGeometry()!.getExtent(),
      data: state.featuresByDataset[layer.datasetId][0].geometry,
      document: createProjectSceneDocument(state.getSnapshot()), selection: state.selection.featureIds }
  })
  await expect.poll(async () => (await read()).code).toBe('EPSG:4527')
  const projected = await read()
  expect(projected.point[0]).toBeGreaterThan(39_000_000)
  expect(projected.data).toMatchObject({ type: 'Point', coordinates: [116.4, 39.9] })
  expect(projected.document.views.map).toMatchObject({ projection: 'EPSG:4527' })
  expect(projected.selection).toEqual(['point-0'])
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  const exported = await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const { serializeVectorExport } = await import('/src/features/export/serializeVectorExport.ts')
    const state = useProjectStore.getState(), layer = state.project.layers.find(item => item.id === state.selectedLayerId)!
    const content = serializeVectorExport(state.featuresByDataset[layer.datasetId], 'coordinate-csv', state.project.crs).content
    const [header, first] = content.trim().split(/\r?\n/).map(line => line.split(','))
    return { x: Number(first[header.indexOf('x')]), y: Number(first[header.indexOf('y')]), crs: first[header.indexOf('crs')] }
  })
  expect(exported.crs).toBe('EPSG:4527')
  expect(exported.x).toBeCloseTo(projected.point[0], 3)
  expect(exported.y).toBeCloseTo(projected.point[1], 3)
  const restored = await page.evaluate(async () => {
    const { createProjectFromSceneDocument } = await import('/src/features/scene/project-scene-document.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const { createProjectSceneDocument } = await import('/src/features/scene/project-scene-document.ts')
    const snapshot = createProjectFromSceneDocument(JSON.parse(JSON.stringify(createProjectSceneDocument(useProjectStore.getState().getSnapshot()))))
    return { code: snapshot.project.crs, geometry: Object.values(snapshot.featuresByDataset)[0][0].geometry }
  })
  expect(restored.code).toBe('EPSG:4527')
  expect(restored.geometry).toEqual(projected.data)
  // UI selection remains usable in the projected native source, not just in the saved document.
  await waitForMapResize(page)
  const current = await mapState(page), second = current.positions[1].pixel
  await drag(page, [second[0] - 12, second[1] - 12], [second[0] + 12, second[1] + 12])
  await expect.poll(async () => (await mapState(page)).selection).toEqual(['point-1'])
  await picker.selectOption('EPSG:4490')
  await expect.poll(async () => (await read()).code).toBe('EPSG:4490')
  expect((await read()).point[0]).toBeCloseTo(116.4, 6)
  await page.getByRole('button', { name: '撤销', exact: true }).first().click()
  await expect.poll(async () => (await read()).code).toBe('EPSG:4527')
  await picker.selectOption('EPSG:4513')
  await expect(picker).toHaveValue('EPSG:4527')
  await expect(page.getByRole('status').last()).toContainText('分带')
  await page.screenshot({ path: info.outputPath('domestic-projection.png') })
})

test('table keyboard keeps input history local, commits outside IME, and locates with Enter', async ({ page }) => {
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  const read = () => page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const state = useProjectStore.getState(), layer = state.project.layers.find(item => item.id === state.selectedLayerId)!
    return (state.featuresByDataset[layer.datasetId] ?? []).map(item => ({ id: item.id, name: item.properties.name }))
  })
  const baseline = await read()
  const row = page.locator('.table-scroll tbody tr[data-feature-id="point-0"]')
  await row.locator('td').last().dblclick()
  const editor = page.locator('.cell-editor')
  await editor.fill('Draft')
  await editor.press('Delete')
  await editor.press('Backspace')
  await editor.press('Control+z')
  expect(await read()).toEqual(baseline)
  await editor.fill('已修改')
  await editor.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
  await expect(editor).toBeVisible()
  expect(await read()).toEqual(baseline)
  await editor.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect.poll(read).toContainEqual({ id: 'point-0', name: '已修改' })
  const search = page.getByRole('searchbox', { name: '表内搜索' })
  await search.fill('已修改')
  await search.press('Delete')
  await search.press('Backspace')
  await search.press('Control+z')
  await expect.poll(read).toContainEqual({ id: 'point-0', name: '已修改' })
  await search.fill('')
  await row.focus()
  await page.keyboard.press('Control+z')
  await expect.poll(read).toEqual(baseline)
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(read).toContainEqual({ id: 'point-0', name: '已修改' })
  const before = (await mapState(page)).center
  await row.focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await mapState(page)).center).not.toEqual(before)
  await row.locator('td').last().dblclick()
  await editor.fill('不应提交')
  await editor.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect.poll(read).toContainEqual({ id: 'point-0', name: '已修改' })
})

test('escape from a focused map cancels the unfinished drawing without changing data', async ({ page }) => {
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  await page.evaluate(async () => {
    const { createProjectSceneController } = await import('/src/features/scene/project-scene-controller.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const { setActiveEditTool } = await import('/src/features/map/map-runtime-host.ts')
    const controller = createProjectSceneController()
    try { controller.transaction('Line drawing fixture', draft => {
      const node = draft.nodes.find(item => item.id === useProjectStore.getState().selectedLayerId)
      if (node?.type === 'vector') node.style = { mode: 'single', symbol: { type: 'solid', color: { r: 0, g: 80, b: 0, a: 1 }, width: 2 } }
    }) } finally { controller.dispose() }
    setActiveEditTool('draw-line')
  })
  const before = await mapState(page)
  const sketchCount = () => page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const draw = getMapRuntime()!.getMap().getInteractions().getArray().find(item => 'getOverlay' in item)
    return draw && 'getOverlay' in draw && typeof draw.getOverlay === 'function'
      ? draw.getOverlay().getSource().getFeatures().length : -1
  })
  const viewport = (await page.locator('.ol-viewport').boundingBox())!
  await page.mouse.click(viewport.x + 100, viewport.y + 100)
  await page.mouse.move(viewport.x + 160, viewport.y + 130)
  await expect.poll(sketchCount).toBeGreaterThan(0)
  await page.getByRole('region', { name: '地图工作区', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await mapState(page)).positions.length).toBe(before.positions.length)
  await expect.poll(sketchCount).toBe(0)
})

test('public scene display edits preserve selection and table through toolbar undo and redo', async ({ page }) => {
  const initial = await mapState(page), first = initial.positions[0].pixel
  await drag(page, [first[0] - 12, first[1] - 12], [first[0] + 12, first[1] + 12])
  await expect(page.getByRole('complementary', { name: '属性表面板' })).toBeVisible()
  await page.getByRole('searchbox', { name: '表内搜索' }).fill('Point')
  const selected = (await mapState(page)).selection
  const exported = await page.evaluate(async () => {
    const { createProjectSceneController } = await import('/src/features/scene/project-scene-controller.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const controller = createProjectSceneController(), id = useProjectStore.getState().selectedLayerId!
    try { controller.setNodeOpacity(id, 0.4); return controller.getDocument().nodes.find(node => node.id === id) }
    finally { controller.dispose() }
  })
  expect(exported).toMatchObject({ opacity: 0.4 })
  await expect.poll(async () => (await mapState(page)).opacity).toBe(0.4)
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await expect(page.getByRole('searchbox', { name: '表内搜索' })).toHaveValue('Point')
  await expect.poll(async () => (await mapState(page)).selection).toEqual(selected)
  await page.getByRole('button', { name: '撤销', exact: true }).first().click()
  await expect.poll(async () => (await mapState(page)).opacity).toBe(1)
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await expect(page.getByRole('searchbox', { name: '表内搜索' })).toHaveValue('Point')
  await page.getByRole('button', { name: '重做', exact: true }).first().click()
  await expect.poll(async () => (await mapState(page)).opacity).toBe(0.4)
  await expect.poll(async () => (await mapState(page)).selection).toEqual(selected)
})

test('drawing commits through document replacement and toolbar undo preserves the active edit target', async ({ page }) => {
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  await page.getByRole('button', { name: '绘制要素', exact: true }).click()
  const bounds = (await page.locator('.ol-viewport').boundingBox())!
  await page.mouse.click(bounds.x + 120, bounds.y + 100)
  await expect.poll(async () => (await mapState(page)).positions.length).toBe(4)
  const snapshot = () => page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const { useWorkbenchStore } = await import('/src/stores/workbench.store.ts')
    const state = useProjectStore.getState(), layer = state.project.layers.find(item => item.id === state.selectedLayerId)!
    return { count: state.featuresByDataset[layer.datasetId].length, target: useWorkbenchStore.getState().editLayerId, layer: layer.id }
  })
  const drawn = await snapshot()
  expect(drawn.count).toBe(4); expect(drawn.target).toBe(drawn.layer)
  await page.getByRole('button', { name: '撤销', exact: true }).first().click()
  await expect.poll(async () => (await mapState(page)).positions.length).toBe(3)
  expect((await snapshot()).target).toBe(drawn.target)
  await page.getByRole('button', { name: '重做', exact: true }).first().click()
  await expect.poll(async () => (await mapState(page)).positions.length).toBe(4)
  expect((await snapshot()).count).toBe(4)
  await page.keyboard.press('Escape')
})

test('public view edits reproject native features and toolbar undo restores the declared view', async ({ page }) => {
  await page.evaluate(async () => {
    const { createProjectSceneController } = await import('/src/features/scene/project-scene-controller.ts')
    const controller = createProjectSceneController()
    try { controller.setView('map', { type: '2d', projection: 'EPSG:4326', center: [116.4, 39.9], zoom: 8 }) }
    finally { controller.dispose() }
  })
  const read = () => page.evaluate(async () => {
    const { getMapRuntime } = await import('/src/features/map/map-runtime-host.ts')
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    const runtime = getMapRuntime()!, view = runtime.getMap().getView()
    const layer = runtime.registry.getVector(useProjectStore.getState().selectedLayerId!)!
    const point = layer.getSource()!.getFeatureById('point-0')!
    return { projection: view.getProjection().getCode(), center: view.getCenter(), extent: point.getGeometry()!.getExtent() }
  })
  await expect.poll(async () => (await read()).projection).toBe('EPSG:4326')
  expect((await read()).extent).toEqual([116.4, 39.9, 116.4, 39.9])
  expect((await read()).center).toEqual([116.4, 39.9])
  await page.getByRole('button', { name: '撤销', exact: true }).first().click()
  await expect.poll(async () => (await read()).projection).toBe('EPSG:3857')
  expect((await read()).extent[0]).toBeGreaterThan(1_000_000)
})

test('escape cancels a live drag and preserves selection and camera', async ({ page }) => {
  const initial = await mapState(page)
  const first = initial.positions[0].pixel
  await drag(page, [first[0] - 12, first[1] - 12], [first[0] + 12, first[1] + 12])
  const before = await mapState(page)
  const bounds = (await page.locator('.ol-viewport').boundingBox())!
  await page.mouse.move(bounds.x + 20, bounds.y + 20)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 200, bounds.y + 150, { steps: 8 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  const after = await mapState(page)
  expect(after.selection).toEqual(before.selection)
  expect(after.center).toEqual(before.center)
})

test('standalone package lifecycle retains highlights and releases only owned resources', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const consumer = await import('/e2e/selection-consumer.ts')
    return consumer.exerciseLifecycle()
  })
  expect(result).toEqual({ retained: 1, ownedInteraction: true, silent: true, interactionsRestored: true,
    overlayReleased: true, sourceIntact: true, mapIntact: true })
})

test('real rotated box selection respects parent group clipping', async ({ page }) => {
  await page.evaluate(async () => (await import('/e2e/selection-consumer.ts')).createClippedFixture())
  await page.waitForTimeout(200)
  const bounds = (await page.locator('#clipped-selection-consumer').boundingBox())!
  await page.mouse.move(bounds.x + 50, bounds.y + 50)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 380, bounds.y + 280, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(async () => (await import('/e2e/selection-consumer.ts')).readClippedSelection())).toEqual(['clip-0'])
  await page.evaluate(async () => (await import('/e2e/selection-consumer.ts')).disposeClippedFixture())
})

test('a deliberate click after a box is accepted and keeps selection on pan', async ({ page }) => {
  const initial = await mapState(page)
  const first = initial.positions[0].pixel
  await drag(page, [first[0] - 12, first[1] - 12], [first[0] + 12, first[1] + 12])
  await expect(page.locator('.table-scroll tbody tr')).toHaveCount(1)
  await waitForMapResize(page)
  const state = await mapState(page)
  const bounds = (await page.locator('.ol-viewport').boundingBox())!
  const point = state.positions[1]
  await page.mouse.click(bounds.x + point.pixel[0], bounds.y + point.pixel[1])
  await expect.poll(async () => (await mapState(page)).selection).toEqual([point.id])
  await page.getByRole('button', { name: '平移', exact: true }).click()
  await drag(page, [100, 100], [150, 100])
  const after = await mapState(page)
  expect(after.selection).toEqual([point.id])
  expect(after.center).not.toEqual(state.center)
})
