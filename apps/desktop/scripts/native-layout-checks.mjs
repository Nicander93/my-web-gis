import assert from 'node:assert/strict'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { expect } from '@playwright/test'

async function state(page) {
  return page.evaluate(async () => {
    const store = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    return { snapshot: store.getSnapshot(), dirty: store.dirty, undo: store.canUndoEdit(), redo: store.canRedoEdit() }
  })
}

async function reachable(locator) {
  await expect(locator).toBeVisible()
  await expect.poll(async () => locator.evaluate(element => {
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return { inside: box.width > 0 && box.height > 0 && box.left >= -1 && box.top >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1,
      unobstructed: hit === element || element.contains(hit), bounds: box.toJSON(), viewport: [innerWidth, innerHeight], hit: hit?.outerHTML.slice(0, 250) }
  }), { message: `Control must settle inside the viewport and remain unobstructed: ${await locator.innerText()}`, timeout: 10_000 }).toMatchObject({ inside: true, unobstructed: true })
}

async function windowMenu(page, name) {
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
}

async function panelChecks(page, canvas) {
  const before = await state(page)
  const bounds = await canvas.boundingBox()
  await canvas.evaluate(element => { element.dataset.nativeLayoutIdentity = 'stable' })
  await windowMenu(page, '诊断')
  const panel = page.getByRole('complementary', { name: '任务与诊断面板' })
  await reachable(panel.getByRole('button', { name: '刷新诊断', exact: true }))
  await panel.getByRole('button', { name: '刷新诊断', exact: true }).click()
  await panel.getByRole('combobox', { name: '任务与诊断停靠位置' }).selectOption('floating')
  await reachable(panel.getByRole('button', { name: '最大化任务与诊断', exact: true }))
  await panel.getByRole('button', { name: '最大化任务与诊断', exact: true }).click()
  await reachable(panel.getByRole('button', { name: '还原任务与诊断', exact: true }))
  await panel.getByRole('button', { name: '还原任务与诊断', exact: true }).click()
  await panel.getByRole('tab', { name: '任务日志', exact: true }).click()
  await reachable(panel.getByRole('button', { name: '清空已结束记录', exact: true }))
  await panel.getByRole('button', { name: '关闭任务与诊断窗口', exact: true }).click()
  assert.deepEqual(await canvas.boundingBox(), bounds)
  await expect(canvas).toHaveAttribute('data-native-layout-identity', 'stable')
  assert.deepEqual(await state(page), before)
}

async function propertiesChecks(page, row, name, field) {
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '完整属性', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `完整属性：${name}`, exact: true })
  for (const label of ['取消', '应用', '确定']) await reachable(dialog.getByRole('button', { name: label, exact: true }))
  const before = await state(page)
  const input = dialog.getByRole('textbox', { name: field, exact: true })
  await input.fill('未提交草稿')
  await input.press('Backspace')
  assert.deepEqual(await state(page), before)
  await input.press('Escape')
  await expect(dialog).toBeHidden()
  assert.deepEqual(await state(page), before)
}

/** Exercises native WebView controls at an explicitly requested renderer scale; no images. */
export async function verifyNativeLayout(page, report, output, saveTo) {
  assert.ok(Math.abs(report.viewport.devicePixelRatio - 1.25) < .01, `Expected controlled WebView DPR 1.25, got ${report.viewport.devicePixelRatio}`)
  report.rendererScale125 = 'Verified controlled WebView scale; OS display setting is recorded separately'
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await reachable(page.getByRole('button', { name: '关闭添加数据', exact: true }))
  await page.locator('input[type=file]').setInputFiles({ name: 'scaled.geojson', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'Feature', properties: { name: '比例验收', value: 42 }, geometry: { type: 'Point', coordinates: [116.4, 39.9] } })) })
  await reachable(page.getByRole('button', { name: '确认导入', exact: true }))
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  const table = page.locator('.attribute-table-tab-panel:visible')
  const beforeCell = (await state(page)).snapshot
  await table.getByRole('cell', { name: '42', exact: true }).dblclick()
  const editor = page.locator('.cell-editor')
  await editor.fill('43')
  await editor.press('Enter')
  await expect(editor).toHaveCount(0)
  await expect(table.getByRole('cell', { name: '43', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.deepEqual((await state(page)).snapshot, beforeCell)
  await table.getByRole('cell', { name: '42', exact: true }).dblclick()
  await editor.fill('99')
  await editor.press('Escape')
  await expect(editor).toHaveCount(0)
  assert.deepEqual((await state(page)).snapshot, beforeCell)
  await page.locator('button[aria-label="结束编辑"]').click()
  report.scenarios.push({ name: '125% native attribute cell double-click, Enter commit, single-step undo and Esc cancellation preserve feature values', passed: true })
  await propertiesChecks(page, page.locator('.layer-item').filter({ hasText: 'scaled' }), 'scaled', '图层名称')
  await panelChecks(page, page.locator('.map-canvas__viewport'))
  await saveTo(join(output, 'layout-map.webgis.json'))
  report.scenarios.push({ name: '125% native 2D import modal, property draft/keyboard cancellation and dock controls remain reachable without data mutation', passed: true })

  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.getByRole('menuitem', { name: /^新建/ }).click()
  const creating = page.getByRole('dialog', { name: '新建项目', exact: true })
  await creating.getByRole('radio', { name: /三维场景/ }).check()
  await creating.getByPlaceholder('例如：园区三维场景').fill('125% native scene')
  await reachable(creating.getByRole('button', { name: '创建项目', exact: true }))
  await creating.getByRole('button', { name: '创建项目', exact: true }).click()
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 60_000 })
  await page.evaluate(async () => {
    (await import('/src/features/scene3d/scene3d-commands.ts')).updateScene('布局验收对象', scene => {
      scene.nodes.push({ id: 'scale-point', name: 'Scaled Point', type: 'graphic', visible: true, geometry: { type: 'point', heightMode: 'ground', positions: [[116.391, 39.907, 0]] }, properties: {}, style: { color: '#2f7655', width: 3, pointSize: 8 } })
      return scene
    })
  })
  await propertiesChecks(page, page.locator('.scene3d-layer-row__select').filter({ hasText: 'Scaled Point' }), 'Scaled Point', '对象名称')
  await page.getByRole('tab', { name: '场景', exact: true }).click()
  const before = await state(page)
  await page.getByRole('button', { name: '添加数据', exact: true }).click()
  const resource = page.getByRole('dialog', { name: '添加三维资源', exact: true })
  await reachable(resource.getByRole('button', { name: '添加到场景', exact: true }))
  await resource.getByRole('textbox', { name: '对象名称', exact: true }).focus()
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab')
    assert.equal(await resource.evaluate(element => element.contains(document.activeElement)), true, 'Modal Tab focus must stay inside its boundary')
  }
  await page.keyboard.press('Escape')
  await expect(resource).toBeHidden()
  assert.deepEqual(await state(page), before)
  await panelChecks(page, page.locator('.scene3d-canvas__viewport canvas'))
  report.scenarios.push({ name: '125% native 3D property/footer reachability, modal Tab/Esc isolation and dock controls preserve scene and canvas identity', passed: true })
}

/** Native IPC save and the real WebView WASI runtime are separate from browser acceptance. */
export async function verifyNativeSimplification(page, report, output, saveTo) {
  const wasmResponses = []
  page.on('response', response => { if (/geolibre-cli[^/]*\.wasm$/.test(new URL(response.url()).pathname)) wasmResponses.push(response.status()) })
  await page.getByRole('button', { name: /^二维地图/ }).click()
  const inputPath = join(output, 'native-routes.geojson')
  await writeFile(inputPath, JSON.stringify({ type: 'Feature', properties: { name: '原生道路', nested: { flags: [true, null] } }, geometry: { type: 'LineString', coordinates: [[116, 39], [116.001, 39.00001], [116.002, 39]] } }))
  await page.evaluate(async path => {
    const { emitTo } = await import('/node_modules/@tauri-apps/api/event.js')
    await emitTo({ kind: 'Webview', label: 'main' }, 'tauri://drag-drop', { paths: [path], position: { x: 400, y: 300 } })
  }, inputPath)
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
  report.fileDrop = { nativeEventBridge: true, nativeFilesystemRead: true, physicalOsDrag: 'Not verified: native drag event emitted by test' }
  const initialCenter = await page.evaluate(async () => (await import('/src/features/map/map-runtime-host.ts')).getMapRuntime().getMap().getView().getCenter())
  const bounds = await page.getByTestId('map-runtime-viewport').boundingBox()
  for (const button of ['middle', 'left']) {
    await page.mouse.move(bounds.x + bounds.width * .55, bounds.y + bounds.height * .55)
    if (button === 'left') await page.keyboard.down('Space')
    await page.mouse.down({ button })
    await page.mouse.move(bounds.x + bounds.width * .55 + 65, bounds.y + bounds.height * .55 + 25, { steps: 6 })
    await page.mouse.up({ button })
    if (button === 'left') await page.keyboard.up('Space')
  }
  assert.notDeepEqual(await page.evaluate(async () => (await import('/src/features/map/map-runtime-host.ts')).getMapRuntime().getMap().getView().getCenter()), initialCenter)
  report.scenarios.push({ name: 'Native file-drop event bridge reads a local path; middle and space-left navigation', passed: true })
  const before = await state(page), source = before.snapshot.project.layers[0]
  const input = before.snapshot.featuresByDataset[source.datasetId][0]
  await page.getByRole('tab', { name: '分析', exact: true }).click()
  await page.getByRole('button', { name: '空间处理', exact: true }).click()
  const panel = page.getByRole('region', { name: '空间处理参数' })
  await panel.getByRole('combobox', { name: '处理工具', exact: true }).selectOption('simplify')
  await panel.getByRole('spinbutton', { name: '简化容差（度）', exact: true }).fill('0.0001')
  await panel.getByLabel('结果图层名称', { exact: true }).fill('原生简化')
  await panel.getByRole('button', { name: '生成结果图层', exact: true }).click()
  await expect(page.locator('.layer-name-button').filter({ hasText: '原生简化' })).toBeVisible({ timeout: 60_000 })
  const after = await state(page), layer = after.snapshot.project.layers.find(layer => layer.name === '原生简化')
  assert.ok(layer)
  const result = after.snapshot.featuresByDataset[layer.datasetId][0]
  assert.deepEqual(result.geometry.coordinates, [input.geometry.coordinates[0], input.geometry.coordinates[2]])
  assert.deepEqual(result.properties, input.properties)
  assert.deepEqual(after.snapshot.featuresByDataset[source.datasetId], before.snapshot.featuresByDataset[source.datasetId])
  await panel.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.deepEqual((await state(page)).snapshot, before.snapshot)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  assert.deepEqual((await state(page)).snapshot, after.snapshot)
  const saved = await saveTo(join(output, 'native-simplified.webgis.json'))
  assert.deepEqual(saved.featuresByDataset, JSON.parse(JSON.stringify(after.snapshot.featuresByDataset)))
  const processing = saved.project.datasets.find(dataset => dataset.id === layer.datasetId).processing
  assert.deepEqual(processing.engine, { id: 'geolibre-wasm', version: '1.7.1', tool: 'simplify_features' })
  assert.deepEqual(wasmResponses, [200])
  report.geolibre = { engine: processing.engine, options: processing.options, wasmResponses, inputVertices: 3, outputVertices: 2 }
  report.scenarios.push({ name: 'Native WebView2 WASI simplification, typed data preservation, undo/redo and real filesystem save', passed: true })
}
