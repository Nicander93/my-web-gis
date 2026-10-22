import assert from 'node:assert/strict'
import { expect } from '@playwright/test'

async function evaluate(page, callback, argument, label = 'Native WebView evaluation', timeoutMs = 10_000) {
  let timer
  try {
    return await Promise.race([
      page.evaluate(callback, argument),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs) })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function locatorEvaluate(locator, callback, timeoutMs = 5_000) {
  let timer
  try {
    return await Promise.race([
      locator.evaluate(callback),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native control geometry evaluation timed out')), timeoutMs) })
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function reachable(locator) {
  await expect(locator).toBeVisible()
  await expect.poll(() => locatorEvaluate(locator, element => {
    const bounds = element.getBoundingClientRect()
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    const statusHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--status-height')) || 0
    return {
      inside: bounds.width > 0 && bounds.height > 0 && bounds.left >= -1 && bounds.top >= -1 &&
        bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight - statusHeight + 1,
      unobstructed: hit === element || element.contains(hit)
    }
  }), { message: 'Native control must remain inside the usable viewport and unobstructed', timeout: 10_000 })
    .toEqual({ inside: true, unobstructed: true })
}

async function projectHistory(page) {
  return evaluate(page, async () => {
    const state = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    return { snapshot: state.getSnapshot(), dirty: state.dirty, undo: state.canUndoEdit(), redo: state.canRedoEdit() }
  }, undefined, 'Project/history read')
}

async function selectOption(page, scope, label, option) {
  const control = scope.getByLabel(label, { exact: true })
  await reachable(control)
  await control.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

async function openWindow(page, name) {
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name, exact: true }).click()
}

async function importCalculatorFixture(page) {
  await page.getByRole('tab', { name: '数据', exact: true }).click()
  await page.getByRole('region', { name: '二维功能区' }).getByRole('button', { name: '添加数据', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: 'native-ux.geojson', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'native-ux-1',
      properties: { value: 12 }, geometry: { type: 'Point', coordinates: [116, 39] } }] })) })
  await page.getByRole('button', { name: '确认导入', exact: true }).click()
}

/** Runs high-value workbench checks inside an isolated native Tauri WebView2 profile. */
export async function verifyNativeUx(page, report) {
  const stage = name => console.log(`[native-ux] ${name}`)
  const initialViewport = report.viewport
  assert.deepEqual({ width: report.requestedWindow.width, height: report.requestedWindow.height }, { width: 1024, height: 680 })
  assert.ok(initialViewport.width >= 700 && initialViewport.height >= 450,
    `Native WebView client area is unexpectedly small: ${initialViewport.width}x${initialViewport.height}`)

  await page.getByRole('button', { name: /^二维地图/ }).click()
  stage('window maximize and restore')
  const beforeSettings = await projectHistory(page)
  const toggleMaximize = () => evaluate(page, async () =>
    (await import('/node_modules/@tauri-apps/api/window.js')).getCurrentWindow().toggleMaximize(), undefined, 'Tauri maximize toggle')
  const isMaximized = () => evaluate(page, async () =>
    (await import('/node_modules/@tauri-apps/api/window.js')).getCurrentWindow().isMaximized(), undefined, 'Tauri maximize state')
  await toggleMaximize()
  await expect.poll(isMaximized).toBe(true)
  await toggleMaximize()
  await expect.poll(isMaximized).toBe(false)
  await expect.poll(() => evaluate(page, () => ({ width: innerWidth, height: innerHeight }), undefined, 'Restored viewport read')).toEqual({
    width: initialViewport.width, height: initialViewport.height
  })
  report.scenarios.push({ name: 'Native WebView maximizes and restores the measured initial client viewport; Tauri was configured for 1024x680', passed: true })

  await page.getByRole('button', { name: '设置', exact: true }).click()
  stage('settings persistence and project isolation')
  const settings = page.getByRole('dialog', { name: '软件设置', exact: true })
  await expect(settings).toBeVisible()
  for (const label of ['软件主题', '界面字号', '控件密度']) await reachable(settings.getByLabel(label, { exact: true }))
  await selectOption(page, settings, '界面字号', '14 px')
  await selectOption(page, settings, '控件密度', '标准')
  await selectOption(page, settings, '软件主题', '深色')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'standard')
  assert.equal(await evaluate(page, () => getComputedStyle(document.documentElement).getPropertyValue('--font-size-ui').trim(), undefined, 'Font token read'), '14px')
  assert.deepEqual(await projectHistory(page), beforeSettings, 'Device preferences must not change GIS project data or edit history')
  await reachable(settings.getByRole('button', { name: '恢复默认外观', exact: true }))
  await settings.getByRole('button', { name: '关闭软件设置', exact: true }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'standard')
  assert.equal(await evaluate(page, () => getComputedStyle(document.documentElement).getPropertyValue('--font-size-ui').trim(), undefined, 'Persisted font token read'), '14px')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const restoredSettings = page.getByRole('dialog', { name: '软件设置', exact: true })
  await reachable(restoredSettings.getByRole('button', { name: '恢复默认外观', exact: true }))
  await restoredSettings.getByRole('button', { name: '恢复默认外观', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  assert.equal(await evaluate(page, () => getComputedStyle(document.documentElement).getPropertyValue('--font-size-ui').trim(), undefined, 'Reset font token read'), '12px')
  await restoredSettings.getByRole('button', { name: '关闭软件设置', exact: true }).click()
  report.scenarios.push({ name: 'Native theme, font size and density persist across WebView reload; preferences leave project/history unchanged and reset action is reachable', passed: true })

  stage('independent task and diagnostics windows')
  await openWindow(page, '任务中心')
  const tasks = page.getByRole('dialog', { name: '任务中心', exact: true })
  await expect(tasks).toBeVisible()
  await openWindow(page, '诊断中心')
  const diagnostics = page.getByRole('dialog', { name: '诊断中心', exact: true })
  await expect(diagnostics).toBeVisible()
  await expect(tasks).toBeVisible()
  const refresh = diagnostics.getByRole('button', { name: '刷新诊断', exact: true })
  await reachable(refresh)
  await refresh.click()
  await diagnostics.getByRole('button', { name: '关闭诊断中心', exact: true }).click()
  await expect(diagnostics).toHaveCount(0)
  await expect(tasks).toBeVisible()
  await tasks.getByRole('button', { name: '关闭任务中心', exact: true }).click()
  await expect(tasks).toHaveCount(0)
  report.scenarios.push({ name: 'Native task and diagnostics windows coexist and close independently', passed: true })

  stage('small-window field calculator reachability')
  await importCalculatorFixture(page)
  await page.getByRole('button', { name: '属性表', exact: true }).click()
  await page.locator('.layer-name-button').filter({ hasText: 'native-ux' }).click()
  await page.getByRole('tab', { name: '编辑', exact: true }).click()
  await page.getByRole('button', { name: '开始编辑', exact: true }).click()
  const table = page.locator('.attribute-table-tab-panel:visible')
  await table.getByRole('button', { name: '字段计算器', exact: true }).click()
  const calculator = page.getByRole('dialog', { name: '字段计算器' })
  await expect(calculator).toBeVisible()
  const usableBounds = await evaluate(page, element => {
    const bounds = element.getBoundingClientRect()
    const statusHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--status-height')) || 0
    return { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, usableBottom: innerHeight - statusHeight }
  }, await calculator.elementHandle(), 'Calculator bounds read')
  assert.ok(usableBounds.left >= 0 && usableBounds.top >= 0 && usableBounds.right <= initialViewport.width && usableBounds.bottom <= usableBounds.usableBottom)
  await reachable(calculator.getByRole('button', { name: '应用计算', exact: true }))
  await reachable(calculator.getByRole('button', { name: '关闭计算器', exact: true }))
  await calculator.getByRole('button', { name: '关闭计算器', exact: true }).click()
  report.scenarios.push({ name: 'Native field calculator critical actions are unobstructed above the status bar in the measured initial viewport', passed: true })
}
