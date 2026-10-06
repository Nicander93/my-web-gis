import type { Viewer } from 'cesium'

export interface RenderQuality {
  resolutionScale: number
  nativeResolution: boolean
  msaaSamples: 1 | 2 | 4 | 8
  fxaa: boolean
}

export const defaultRenderQuality: RenderQuality = { resolutionScale: 1, nativeResolution: true, msaaSamples: 4, fxaa: true }

export function isRenderQuality(value: unknown): value is RenderQuality {
  if (!value || typeof value !== 'object') return false
  const quality = value as Partial<RenderQuality>
  return typeof quality.resolutionScale === 'number' && Number.isFinite(quality.resolutionScale) && quality.resolutionScale >= .5 && quality.resolutionScale <= 2 && [1,2,4,8].includes(quality.msaaSamples ?? 0) && typeof quality.nativeResolution === 'boolean' && typeof quality.fxaa === 'boolean'
}

/** Validate before touching the renderer so invalid input cannot partially change it. */
export function applyRenderQuality(viewer: Viewer, quality: RenderQuality): void {
  if (!isRenderQuality(quality)) throw new Error('渲染质量参数无效')
  viewer.useBrowserRecommendedResolution = !quality.nativeResolution
  viewer.resolutionScale = quality.resolutionScale
  viewer.scene.msaaSamples = quality.msaaSamples
  viewer.scene.postProcessStages.fxaa.enabled = quality.fxaa
  viewer.resize()
  viewer.scene.requestRender()
}
