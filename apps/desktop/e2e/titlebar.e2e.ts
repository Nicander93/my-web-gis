import { test, expect } from '@playwright/test'

test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })

test('browser header keeps menus reachable without native controls or drag regions', async ({ page }) => {
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await expect(page.locator('.brand-mark img')).toBeVisible()
  await expect.poll(() => page.locator('.brand-mark img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(page.locator('.window-controls')).toHaveCount(0)
  await expect(page.locator('[data-tauri-drag-region]')).toHaveCount(0)
  await page.locator('.menu-trigger').filter({ hasText: '文件' }).click()
  await expect(page.getByRole('menu', { name: '文件菜单' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: '文件菜单' })).toHaveCount(0)
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.locator('[data-map-runtime="mounted"]')).toBeVisible()
  await expect(page.locator('.window-controls')).toHaveCount(0)
  const boxes = await page.locator('.brand-lockup, .window-context').evaluateAll(elements => elements.map(element => {
    const { left, right } = element.getBoundingClientRect()
    return { left, right }
  }))
  expect(boxes[0].right).toBeLessThanOrEqual(boxes[1].left)
})

test('3D workspace shares the header and truncates long names without overlapping menus', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /^三维场景/ }).click()
  await expect(page.locator('.project-kind')).toHaveText('三维场景')
  await page.evaluate(async () => {
    // Exercise the shared shell with a real project state, independently of Cesium tile loading.
    // @ts-expect-error Vite source module is resolved by the browser.
    const { useProjectStore } = await import(performance.getEntriesByType('resource').map(entry => entry.name).findLast(url => new URL(url).pathname === '/src/stores/project.store.ts') ?? '/src/stores/project.store.ts')
    useProjectStore.setState((state: { project: object }) => ({ project: { ...state.project, name: '项目名称'.repeat(40) }, dirty: true }))
  })
  await expect(page.locator('.project-dirty')).toBeVisible()
  await expect(page.locator('.window-controls')).toHaveCount(0)
  const geometry = await page.locator('.window-context').evaluate(element => {
    const name = element.querySelector('.workspace-name')!
    return { menuRight: document.querySelector('.brand-lockup')!.getBoundingClientRect().right,
      contextLeft: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      viewport: innerWidth, truncated: name.scrollWidth > name.clientWidth }
  })
  expect(geometry.menuRight).toBeLessThanOrEqual(geometry.contextLeft)
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport)
  expect(geometry.truncated).toBe(true)
})

test('open menus switch on hover and keep keyboard navigation, focus and typing intact', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '文件', exact: true }).hover()
  await expect(page.getByRole('menu', { name: '文件菜单' })).toHaveCount(0)
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await expect(page.getByRole('menu', { name: '文件菜单' })).toBeVisible()
  await page.getByRole('button', { name: '窗口', exact: true }).hover()
  await expect(page.getByRole('menu', { name: '窗口菜单' })).toBeVisible()
  await expect(page.getByRole('menu', { name: '文件菜单' })).toHaveCount(0)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('dialog', { name: '软件设置', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '软件设置', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '窗口', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: '图层面板', exact: true }).click()
  await expect(page.getByRole('button', { name: '窗口', exact: true })).toBeFocused()
  await page.getByRole('button', { name: '文件', exact: true }).click()
  await page.getByRole('menuitem', { name: /^新建/ }).click()
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true })
  const name = dialog.getByRole('textbox')
  await name.fill('甲')
  await page.keyboard.press('ArrowRight')
  await expect(name).toBeFocused()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
})
