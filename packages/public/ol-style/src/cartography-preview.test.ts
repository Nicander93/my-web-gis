import { expect, it, vi } from 'vitest'
import type VectorLayer from 'ol/layer/Vector.js'
import type VectorSource from 'ol/source/Vector.js'

const renderer = vi.hoisted(() => ({ setStyle: vi.fn(), drawFeature: vi.fn() }))
vi.mock('ol/render.js', () => ({ toContext: () => renderer }))
vi.mock('./maplibre-adapter.js', async () => {
  const { default: Style } = await import('ol/style/Style.js')
  return { createMapLibreCanvasBinding: (layer: VectorLayer<VectorSource>) => ({ update: async () => {
    let installed = false
    layer.setStyle(() => {
      if (!installed) throw new Error('Style metadata is not installed yet')
      return new Style()
    })
    await Promise.resolve()
    installed = true
    return true
  } }) }
})

it('waits for style installation before reacting to the renderer initial change events', async () => {
  const { createCartographyPreview } = await import('./cartography-preview.js')
  const clearRect = vi.fn()
  const canvas = { width: 96, height: 40, getContext: () => ({ clearRect }) } as unknown as HTMLCanvasElement
  const dispose = await createCartographyPreview(canvas, { layers: [], assets: [], geometry: 'point' })
  expect(renderer.drawFeature).toHaveBeenCalledOnce()
  expect(clearRect).toHaveBeenCalledOnce()
  dispose()
})
