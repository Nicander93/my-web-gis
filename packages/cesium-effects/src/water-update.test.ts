import { expect, it, vi } from 'vitest'
import type { Viewer } from 'cesium'
import { WaterLayer } from './index'

vi.mock('cesium', async original => {
  const actual = await original<typeof import('cesium')>()
  return { ...actual, buildModuleUrl: () => './normal.jpg',
    Material: { fromType: (_type: string, uniforms: object) => { let destroyed = false; return { uniforms, destroy: () => { destroyed = true }, isDestroyed: () => destroyed } } },
    MaterialAppearance: Object.assign(class { constructor(readonly options: unknown) {} }, { MaterialSupport: actual.MaterialAppearance.MaterialSupport }),
    Primitive: class { destroyed = false; constructor(readonly options: unknown) {} destroy() { this.destroyed = true } isDestroyed() { return this.destroyed } }
  }
})

it('reuses water material, replaces height geometry, releases ticks and destroys the latest primitive', async () => {
  const primitives: Array<{ destroy(): void; isDestroyed(): boolean }> = [], ticks = new Set<() => void>()
  const viewer = { isDestroyed: () => false, clock: { onTick: { addEventListener: (callback: () => void) => { ticks.add(callback); return () => ticks.delete(callback) } } }, scene: { requestRender: vi.fn(), primitives: {
    add: (primitive: typeof primitives[number]) => { primitives.push(primitive) },
    remove: (primitive: typeof primitives[number]) => { primitive.destroy(); return true }
  } } } as unknown as Viewer
  const water = new WaterLayer({ id: 'water', height: 0, boundary: [[116,39,0], [116.001,39,0], [116.001,39.001,0]] })
  await water.mount(viewer)
  const original = water.primitive!
  water.setOptions({ amplitude: 8, speed: 0 })
  expect(water.primitive).toBe(original)
  expect(water.getParameters()).toEqual({ height: 0, amplitude: 8, frequency: 1000, speed: 0 })
  expect(ticks.size).toBe(0)
  water.setOptions({ height: 15, speed: .02 })
  expect(water.primitive).not.toBe(original)
  expect(original.isDestroyed()).toBe(true)
  expect(ticks.size).toBe(1)
  expect(water.getParameters()).toEqual({ height: 15, amplitude: 8, frequency: 1000, speed: .02 })
  const last = water.primitive!
  expect(() => water.setOptions({ frequency: 0 })).toThrow('无效')
  expect(water.primitive).toBe(last)
  water.destroy(); water.destroy()
  expect(last.isDestroyed()).toBe(true)
  expect(ticks.size).toBe(0)
  expect(primitives).toHaveLength(2)
})
