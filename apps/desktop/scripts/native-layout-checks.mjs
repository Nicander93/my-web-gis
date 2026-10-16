import assert from 'node:assert/strict'
import { join } from 'node:path'
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
