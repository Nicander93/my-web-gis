import assert from 'node:assert/strict'
import { expect } from '@playwright/test'

/** Real WebView2 checks; OS mouse dragging and Snap Layout are reported separately. */
export async function verifyNativeTitlebar(page, report) {
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  const state = () => page.evaluate(async () => {
    const window = (await import('/node_modules/@tauri-apps/api/window.js')).getCurrentWindow()
    return { maximized: await window.isMaximized(), minimized: await window.isMinimized(), decorated: await window.isDecorated(), resizable: await window.isResizable() }
  })
  await expect(page.locator('.window-controls .ant-btn')).toHaveCount(3)
  assert.equal((await state()).decorated, false)
  assert.equal((await state()).resizable, true)
  const height = await page.locator('.window-bar').evaluate(element => element.getBoundingClientRect().height)
  assert.ok(Math.abs(height - 36) < 0.5, `Expected 36 CSS px with native DPI rounding, got ${height}`)
  await page.getByRole('button', { name: '最大化窗口', exact: true }).click()
  await expect.poll(async () => (await state()).maximized).toBe(true)
  await page.getByRole('button', { name: '还原窗口', exact: true }).click()
  await expect.poll(async () => (await state()).maximized).toBe(false)
  // Exercise the actual injected Tauri drag script and its ACL, not a mocked window API.
  await page.locator('.window-context').dispatchEvent('mousedown', { button: 0, detail: 2 })
  await expect.poll(async () => (await state()).maximized).toBe(true)
  await expect(page.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible()
  await page.locator('.window-context').dispatchEvent('mousedown', { button: 0, detail: 2 })
  await expect.poll(async () => (await state()).maximized).toBe(false)
  await page.locator('.menu-trigger').filter({ hasText: '文件' }).dblclick()
  assert.equal((await state()).maximized, false)
  await page.keyboard.press('Escape')
  report.scenarios.push({ name: 'Native undecorated window, real maximize/restore and injected double-click handling; menu does not maximize', passed: true })

  await page.getByRole('button', { name: '最小化窗口', exact: true }).click()
  await expect.poll(async () => (await state()).minimized).toBe(true)
  await page.evaluate(async () => (await import('/node_modules/@tauri-apps/api/window.js')).getCurrentWindow().toggleMaximize())
  await expect.poll(async () => (await state()).maximized).toBe(true)
  await page.getByRole('button', { name: '还原窗口', exact: true }).click()
  report.scenarios.push({ name: 'Native minimize and API restoration synchronize titlebar state', passed: true })

  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.locator('[data-map-runtime="mounted"]')).toBeVisible()
  const before = await page.evaluate(async () => {
    const state = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    return { snapshot: state.getSnapshot(), dirty: state.dirty }
  })
  await page.getByRole('button', { name: '最大化窗口', exact: true }).click()
  await page.getByRole('button', { name: '还原窗口', exact: true }).click()
  const after = await page.evaluate(async () => {
    const state = (await import('/src/stores/project.store.ts')).useProjectStore.getState()
    return { snapshot: state.getSnapshot(), dirty: state.dirty }
  })
  assert.deepEqual(after, before)
  assert.deepEqual(errors, [])
  report.scenarios.push({ name: 'Window operations preserve 2D project snapshot and dirty state without runtime errors', passed: true })

  await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    useProjectStore.setState({ dirty: true })
  })
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  const closing = page.getByRole('dialog', { name: '项目尚未保存', exact: true })
  await expect(closing).toBeVisible()
  await closing.getByRole('button', { name: '取消', exact: true }).click()
  await expect(closing).toHaveCount(0)
  assert.equal((await state()).decorated, false)
  await page.evaluate(async () => (await import('/node_modules/@tauri-apps/api/window.js')).getCurrentWindow().close())
  await expect(closing).toBeVisible()
  await closing.getByRole('button', { name: '取消', exact: true }).click()
  await expect(closing).toHaveCount(0)
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect(closing).toBeVisible()
  await page.evaluate(async () => (await import('/node_modules/@tauri-apps/api/window.js')).getCurrentWindow().close())
  await expect(closing).toHaveCount(1)
  await closing.getByRole('button', { name: '取消', exact: true }).click()
  await page.evaluate(async () => {
    const { useProjectStore } = await import('/src/stores/project.store.ts')
    useProjectStore.setState({ dirty: false })
  })
  report.scenarios.push({ name: 'Title-bar close and window.close() share one unsaved prompt; a second request does not stack dialogs', passed: true })
  await page.evaluate(async () => {
    const { registerPendingPropertyEdit } = await import('/src/services/pending-property-edits.ts')
    globalThis.__releaseTitlebarDraft = registerPendingPropertyEdit()
  })
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect(page.getByText('关闭窗口失败：请先应用或取消完整属性窗口中的编辑，再关闭项目。', { exact: true })).toBeVisible()
  await expect(closing).toHaveCount(0)
  assert.equal((await state()).decorated, false)
  await page.evaluate(() => { globalThis.__releaseTitlebarDraft(); delete globalThis.__releaseTitlebarDraft })
  report.scenarios.push({ name: 'Uncommitted modeless form blocks native close even when project dirty is false', passed: true })
  report.titlebarManualPending = [
    'Physical mouse dragging and edge/corner resize',
    'Windows Snap Layout hover panel on the maximize button',
    'Win+arrow snapping, real OS 100%/125%/150% DPI and cross-monitor movement',
    'Save-and-close or discard-and-close ending the native process',
    'Alt+F4 and taskbar close on a real shell (same JS path as window.close() was checked)'
  ]
}
