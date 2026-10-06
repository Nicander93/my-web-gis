import { describe, expect, it, vi } from 'vitest'
import type { Viewer } from 'cesium'
import { applyRenderQuality, defaultRenderQuality } from './render-quality'

describe('render quality', () => {
  it('uses device pixels, changes actual render controls and requests a new frame', () => {
    const viewer = { scene: { postProcessStages: { fxaa: { enabled: false } }, requestRender: vi.fn(), msaaSamples: 1 }, resize: vi.fn() } as unknown as Viewer
    applyRenderQuality(viewer, { ...defaultRenderQuality, resolutionScale: 1.5, msaaSamples: 8 })
    expect(viewer.useBrowserRecommendedResolution).toBe(false)
    expect(viewer.resolutionScale).toBe(1.5)
    expect(viewer.scene.msaaSamples).toBe(8)
    expect(viewer.scene.postProcessStages.fxaa.enabled).toBe(true)
    expect(viewer.resize).toHaveBeenCalledOnce()
    expect(viewer.scene.requestRender).toHaveBeenCalledOnce()
  })
  it('rejects invalid quality before changing any viewer state', () => {
    const viewer = { resolutionScale: 1 } as Viewer
    expect(() => applyRenderQuality(viewer, { ...defaultRenderQuality, resolutionScale: NaN })).toThrow()
    expect(() => applyRenderQuality(viewer, { ...defaultRenderQuality, resolutionScale: 5 })).toThrow()
    expect(viewer.resolutionScale).toBe(1)
  })
})
