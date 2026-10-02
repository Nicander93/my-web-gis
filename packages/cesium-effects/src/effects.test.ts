import { describe, expect, it, vi } from 'vitest'
import type { Viewer } from 'cesium'
import { CityEffects } from './index'

describe('host effect ownership', () => {
  it('restores the exact host settings and disposes idempotently', () => {
    const viewer = { isDestroyed: () => false, scene: { fog: { enabled: true, density: .0002 }, postProcessStages: { bloom: { enabled: true } }, requestRender: vi.fn() } } as unknown as Viewer
    const effects = new CityEffects(viewer)
    effects.update({ fog: .5, bloom: false })
    expect(viewer.scene.fog.density).toBe(.001)
    effects.destroy(); effects.destroy()
    expect(viewer.scene.fog).toEqual({ enabled: true, density: .0002 })
    expect(viewer.scene.postProcessStages.bloom.enabled).toBe(true)
    expect(() => effects.update({ fog: 0, bloom: false })).toThrow('已销毁')
  })
})
