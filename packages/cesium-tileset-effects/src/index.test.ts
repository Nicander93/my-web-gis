import { describe, expect, it, vi } from 'vitest'
import { ClippingPolygonCollection } from 'cesium'
import type { Cesium3DTileset, Scene } from 'cesium'
import type { TilesetClipEffect } from '@desktop-webgis/cesium-scene-schema'
import { TilesetEffectError, TilesetEffectManager } from './index'

function target() {
  return { clippingPolygons: undefined, isDestroyed: () => false } as unknown as Cesium3DTileset
}
const effects: TilesetClipEffect[] = [
  { id: 'a', kind: 'clip-polygon', enabled: true, mode: 'keep-inside', positions: [[116.39, 39.90, 0], [116.40, 39.90, 0], [116.40, 39.91, 0]] },
  { id: 'b', kind: 'clip-polygon', enabled: true, mode: 'keep-inside', positions: [[116.41, 39.90, 0], [116.42, 39.90, 0], [116.42, 39.91, 0]] }
]

describe('TilesetEffectManager', () => {
  it('installs multiple isolated polygons, maps keep-inside to inverse, and restores prior state', () => {
    vi.spyOn(ClippingPolygonCollection, 'isSupported').mockReturnValue(true)
    const manager = new TilesetEffectManager(), tileset = target(), render = vi.fn()
    const previous = new ClippingPolygonCollection()
    tileset.clippingPolygons = previous
    manager.setEffects('tiles', tileset, effects, { requestRender: render } as unknown as Scene)
    expect(tileset.clippingPolygons).not.toBe(previous)
    expect(tileset.clippingPolygons.inverse).toBe(true)
    expect(tileset.clippingPolygons.length).toBe(2)
    manager.removeEffects('tiles')
    expect(tileset.clippingPolygons).toBe(previous)
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('reports unsupported contexts and mixed modes without mutating the target', () => {
    const manager = new TilesetEffectManager(), tileset = target(), scene = { requestRender: vi.fn() } as unknown as Scene
    vi.spyOn(ClippingPolygonCollection, 'isSupported').mockReturnValue(false)
    expect(() => manager.setEffects('tiles', tileset, effects, scene)).toThrowError(TilesetEffectError)
    expect(tileset.clippingPolygons).toBeUndefined()
    vi.mocked(ClippingPolygonCollection.isSupported).mockReturnValue(true)
    expect(() => manager.setEffects('tiles', tileset, [{ ...effects[0] }, { ...effects[1], mode: 'keep-outside' }], scene)).toThrow('混合')
    expect(tileset.clippingPolygons).toBeUndefined()
  })

  it('keeps an identical installation and does not transfer state between targets', () => {
    vi.spyOn(ClippingPolygonCollection, 'isSupported').mockReturnValue(true)
    const manager = new TilesetEffectManager(), first = target(), second = target(), render = vi.fn()
    const firstPrevious = new ClippingPolygonCollection(), secondPrevious = new ClippingPolygonCollection()
    first.clippingPolygons = firstPrevious; second.clippingPolygons = secondPrevious
    const scene = { requestRender: render } as unknown as Scene
    manager.setEffects('tiles', first, effects, scene)
    const installed = first.clippingPolygons
    manager.setEffects('tiles', first, structuredClone(effects), scene)
    expect(first.clippingPolygons).toBe(installed)
    manager.setEffects('tiles', second, effects, scene)
    expect(first.clippingPolygons).toBe(firstPrevious)
    manager.removeEffects('tiles')
    expect(second.clippingPolygons).toBe(secondPrevious)
  })

  it('isolates collections owned by different tilesets', () => {
    vi.spyOn(ClippingPolygonCollection, 'isSupported').mockReturnValue(true)
    const manager = new TilesetEffectManager(), first = target(), second = target(), scene = { requestRender: vi.fn() } as unknown as Scene
    manager.setEffects('first', first, effects, scene)
    manager.setEffects('second', second, effects.map(effect => ({ ...effect, positions: effect.positions.map(([lon,lat,height]) => [lon + 1,lat,height]) })), scene)
    expect(first.clippingPolygons).not.toBe(second.clippingPolygons)
    manager.removeEffects('first')
    expect(first.clippingPolygons).toBeUndefined()
    expect(second.clippingPolygons?.length).toBe(2)
  })
})
