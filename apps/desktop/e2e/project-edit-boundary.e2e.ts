import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function state(page: Page) {
  return page.evaluate(async () => {
    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    const { featureData } = await import(active('/src/data/feature-data.ts'))
    const { projectEdits } = await import(active('/src/session/project-edits.ts'))
    const current = useProjectStore.getState()
    return { opacity: current.project.content.layers[0].opacity, dataRevision: featureData.revision,
      canUndo: projectEdits.canUndo(), canRedo: projectEdits.canRedo() }
  })
}

test('opacity keyboard gestures have separate undo steps and repeated keys coalesce without editing data', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  await page.evaluate(async () => {
    const { layerContentCommands } = await import(performance.getEntriesByType('resource').map(entry => entry.name).filter(name => new URL(name).pathname === '/src/commands/layer-content.commands.ts').at(-1) ?? '/src/commands/layer-content.commands.ts')

    const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === path).at(-1) ?? path
    const { useProjectStore } = await import(active('/src/session/project.store.ts'))
    layerContentCommands.addLayer('data', 'Gesture data', [{ id: 'one', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { value: 1 } }], 'point')
  })
  await page.getByRole('button', { name: '图层属性', exact: true }).click()
  const opacity = page.getByRole('slider', { name: '不透明度', exact: true })
  await opacity.focus()
  const before = await state(page)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(opacity).toHaveValue('98')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(opacity).toHaveValue('99')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect(opacity).toHaveValue('98')
  await opacity.focus()
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.down('ArrowLeft')
  await page.keyboard.up('ArrowLeft')
  await expect(opacity).toHaveValue('95')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(opacity).toHaveValue('98')
  expect(await state(page)).toEqual({ opacity: 0.98, dataRevision: before.dataRevision, canUndo: true, canRedo: true })
  expect(errors).toEqual([])
})

test('navigation stays runtime-only until explicitly setting the initial view, with undo and file reopen', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => performance.setResourceTimingBufferSize(5000))
  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: /^二维地图/ }).click()
  async function viewState() {
    return page.evaluate(async () => {
      const active = (path: string) => performance.getEntriesByType('resource').map(entry => entry.name)
        .filter(name => new URL(name).pathname === path).at(-1) ?? path
      const { useProjectStore } = await import(active('/src/session/project.store.ts'))
      const { getLiveMapState, getMapRuntime } = await import(active('/src/runtime/map-runtime-host.ts'))
      const { featureData } = await import(active('/src/data/feature-data.ts'))
      const { projectEdits } = await import(active('/src/session/project-edits.ts'))
      const state = useProjectStore.getState()
      return { initial: state.project.content.initialView, live: getLiveMapState(), animating: getMapRuntime()?.getMap().getView().getAnimating() ?? false, dirty: state.dirty,
        epoch: state.projectEpoch, revision: state.configRevision, dataRevision: featureData.revision, canUndo: projectEdits.canUndo() }
    })
  }
  async function save(name: string) {
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: '保存项目', exact: true }).click()
    const output = info.outputPath(name)
    await (await download).saveAs(output)
    await expect.poll(async () => (await viewState()).dirty).toBe(false)
    return { output, content: JSON.parse(readFileSync(output, 'utf8')).project.content }
  }
  await expect.poll(async () => !!(await viewState()).live).toBe(true)
  const before = await viewState()
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await expect.poll(async () => (await viewState()).live!.zoom > before.live!.zoom + .9).toBe(true)
  await expect.poll(async () => (await viewState()).animating).toBe(false)
  const navigated = await viewState()
  expect(navigated.initial).toEqual(before.initial)
  expect(navigated.revision).toBe(before.revision)
  expect(navigated.canUndo).toBe(false)
  expect((await save('navigation-only.webgis.json')).content.initialView).toEqual(before.initial)
  await page.getByRole('button', { name: '设为初始视角', exact: true }).click()
  await expect.poll(async () => (await viewState()).initial).toEqual(navigated.live)
  expect((await viewState()).dirty).toBe(true)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(async () => (await viewState()).initial).toEqual(before.initial)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await expect.poll(async () => (await viewState()).initial).toEqual(navigated.live)
  expect((await viewState()).dataRevision).toBe(before.dataRevision)
  const saved = await save('explicit-preset.webgis.json')
  expect(saved.content.initialView).toEqual(navigated.live)
  const epoch = (await viewState()).epoch
  await page.getByRole('button', { name: '文件', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: /^打开/ }).click()
  await (await chooser).setFiles(saved.output)
  await expect.poll(async () => (await viewState()).epoch).toBe(epoch + 1)
  await expect.poll(async () => (await viewState()).initial).toEqual(navigated.live)
  await expect.poll(async () => {
    const live = (await viewState()).live
    return !!live && Math.abs(live.zoom - navigated.live!.zoom) < 1e-7
  }).toBe(true)
  expect((await viewState()).canUndo).toBe(false)
  expect(errors).toEqual([])
})
