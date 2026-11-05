import { expect, test, type Page } from '@playwright/test'

async function replaceProject(page: Page, type: '2d' | '3d') {
  return page.evaluate(async type => {
    const { projectSession } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-session.ts').at(-1) ?? '/src/project/project-session.ts')

    const { projectEdits } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/project/project-edits.ts').at(-1) ?? '/src/project/project-edits.ts')

    const loaded = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(loaded('/src/project/project.store.ts')) as typeof import('@/project/project.store')
    const { createEditorProject } = await import(loaded('/src/project/project-type.ts')) as typeof import('@/project/project-type')
    const previousEpoch = useProjectStore.getState().projectEpoch
    const project = createEditorProject(type, `Replacement ${type}`)
    // Reopening a project may retain its ID; epoch, rather than identity, owns the old runtime.
    project.metadata.id = useProjectStore.getState().project.metadata.id
    projectSession.loadSnapshot({ project, featuresByDataset: {} })
    const state = useProjectStore.getState()
    return { kind: state.project.content.kind, keys: Object.keys(state.project.content), epochDelta: state.projectEpoch - previousEpoch,
      configRevision: state.configRevision, dirty: state.dirty, canUndo: projectEdits.canUndo() }
  }, type)
}

test('replaces a mounted 2D workspace with 3D and back without reading the previous workspace content', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await expect(page.locator('[data-map-runtime="mounted"]')).toBeVisible()
  const scene = await replaceProject(page, '3d')
  expect(scene).toEqual({ kind: 'scene3d', keys: ['kind', 'scene', 'settings'], epochDelta: 1, configRevision: 0, dirty: false, canUndo: false })
  await expect(page.locator('.scene3d-footer__state')).toHaveText('就绪', { timeout: 30_000 })
  await expect(page.locator('.map-canvas')).toHaveCount(0)
  const map = await replaceProject(page, '2d')
  expect(map).toMatchObject({ kind: 'map2d', epochDelta: 1, configRevision: 0, dirty: false, canUndo: false })
  expect(map.keys).not.toContain('scene')
  await expect(page.locator('[data-map-runtime="mounted"]')).toBeVisible()
  await expect(page.locator('.scene3d-workspace')).toHaveCount(0)
  expect(errors).toEqual([])
})
