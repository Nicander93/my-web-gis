import { test, expect, type Page } from '@playwright/test'

test.use({ screenshot: 'off', trace: { mode: 'retain-on-failure', screenshots: false } })

async function geometry(page: Page, selector = '.workbench-ribbon button, .workbench-ribbon button > svg, .workbench-ribbon button > span') {
  return page.locator(selector).evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node)
    return { text: node.textContent, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      display: style.display, border: style.borderWidth, padding: style.padding, weight: style.fontWeight }
  }))
}

for (const mode of ['二维地图', '三维场景']) {
  test(`${mode} ribbon buttons and tabs keep geometry on hover`, async ({ page }) => {
    await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
    await page.goto('/')
    await page.getByRole('button', { name: new RegExp(`^${mode}`) }).click()
    await expect(page.locator('.workbench-ribbon')).toBeVisible()
    if (mode === '三维场景') await page.getByRole('tab', { name: '标绘', exact: true }).click()
    await page.mouse.move(700, 400)
    const before = await geometry(page)
    const controls = page.locator('.workbench-ribbon button:enabled:visible')
    for (let index = 0; index < await controls.count(); index++) {
      const control = controls.nth(index)
      await control.hover()
      await expect.poll(() => geometry(page), { message: `hover ${await control.getAttribute('aria-label') ?? await control.textContent()}` }).toEqual(before)
      await page.mouse.down()
      try { expect(await geometry(page)).toEqual(before) }
      finally { await page.mouse.move(700, 400); await page.mouse.up() }
    }
    const tabs = page.getByRole('tablist').first().getByRole('tab')
    const tabGeometry = await geometry(page, '.workbench-ribbon-top [role=tab], .workbench-ribbon-top [role=tab] > span')
    for (let index = 0; index < await tabs.count(); index++) {
      await tabs.nth(index).click()
      expect(await geometry(page, '.workbench-ribbon-top [role=tab], .workbench-ribbon-top [role=tab] > span')).toEqual(tabGeometry)
    }
  })
}

test('shared start-screen buttons reserve the same border on hover and press', async ({ page }) => {
  await page.goto('/')
  const buttons = page.getByRole('main', { name: '项目起始页' }).getByRole('button')
  await expect(buttons).toHaveCount(3)
  await page.mouse.move(5, 5)
  const selector = 'main button, main button > span, main button > svg'
  const before = await geometry(page, selector)
  for (let index = 0; index < await buttons.count(); index++) {
    await buttons.nth(index).hover()
    expect(await geometry(page, selector)).toEqual(before)
    await page.mouse.down()
    try { expect(await geometry(page, selector)).toEqual(before) }
    finally { await page.mouse.move(5, 5); await page.mouse.up() }
  }
})
