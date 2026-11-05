import { describe, expect, it, vi } from 'vitest'
import { ClippingPolygonCollection, CustomShader } from 'cesium'
import type { Cesium3DTileset, Scene } from 'cesium'
import type { TilesetClipEffect, TilesetFlattenEffect } from '@desktop-webgis/cesium-scene-schema'
import { buildFlattenMask, TilesetEffectError, TilesetEffectManager } from './index'

function target() {
  return { clippingPolygons: undefined, customShader: undefined, isDestroyed: () => false } as unknown as Cesium3DTileset
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

  it('builds a bounded multi-height mask and rejects non-local extents', () => {
    const flattening: TilesetFlattenEffect[] = [
      { id: 'low', kind: 'flatten-polygon', enabled: true, height: 10, positions: [[116.39,39.9,0],[116.391,39.9,0],[116.391,39.901,0],[116.39,39.901,0]] },
      { id: 'high', kind: 'flatten-polygon', enabled: true, height: 42, positions: [[116.392,39.9,0],[116.393,39.9,0],[116.393,39.901,0],[116.392,39.901,0]] }
    ]
    const mask = buildFlattenMask(flattening, 128)
    expect(mask.width).toBeLessThanOrEqual(128); expect(mask.height).toBeLessThanOrEqual(128)
    const opaque = Array.from({ length: mask.data.length / 4 }, (_, index) => index).filter(index => mask.data[index * 4 + 3] === 255)
    expect(opaque.length).toBeGreaterThan(0)
    expect(new Set(opaque.map(index => `${mask.data[index * 4]},${mask.data[index * 4 + 1]},${mask.data[index * 4 + 2]}`)).size).toBe(2)
    expect(() => buildFlattenMask([{ ...flattening[0], positions: [[0,0,0],[1,0,0],[1,1,0]] }], 128)).toThrow('5000')
  })

  it('installs and deterministically destroys its flatten shader', () => {
    const manager = new TilesetEffectManager(), tileset = target(), render = vi.fn()
    const flatten: TilesetFlattenEffect = { id: 'flat', kind: 'flatten-polygon', enabled: true, height: 15, positions: [[116.39,39.9,0],[116.391,39.9,0],[116.391,39.901,0]] }
    manager.setEffects('tiles', tileset, [flatten], { context: { maximumTextureSize: 256 }, requestRender: render } as unknown as Scene)
    const shader = tileset.customShader
    expect(shader).toBeDefined(); expect(shader?.isDestroyed()).toBe(false)
    manager.removeEffects('tiles')
    expect(tileset.customShader).toBeUndefined(); expect(shader?.isDestroyed()).toBe(true)
  })

  it('refuses to overwrite a caller-owned custom shader', () => {
    const manager = new TilesetEffectManager(), tileset = target(), existing = new CustomShader({})
    tileset.customShader = existing
    const flatten: TilesetFlattenEffect = { id: 'flat', kind: 'flatten-polygon', enabled: true, height: 15, positions: [[116.39,39.9,0],[116.391,39.9,0],[116.391,39.901,0]] }
    expect(() => manager.setEffects('tiles', tileset, [flatten], { context: { maximumTextureSize: 256 }, requestRender: vi.fn() } as unknown as Scene)).toThrow('CustomShader')
    expect(tileset.customShader).toBe(existing); expect(existing.isDestroyed()).toBe(false)
    existing.destroy()
  })

  it('preserves host state that changes after installation', () => {
    vi.spyOn(ClippingPolygonCollection, 'isSupported').mockReturnValue(true)
    const manager = new TilesetEffectManager(), tileset = target(), scene = { context: { maximumTextureSize: 256 }, requestRender: vi.fn() } as unknown as Scene
    manager.setEffects('tiles', tileset, effects, scene)
    const externalClipping = new ClippingPolygonCollection(), externalShader = new CustomShader({})
    tileset.clippingPolygons = externalClipping; tileset.customShader = externalShader
    const flatten: TilesetFlattenEffect = { id: 'flat', kind: 'flatten-polygon', enabled: true, height: 15, positions: [[116.39,39.9,0],[116.391,39.9,0],[116.391,39.901,0]] }
    expect(() => manager.setEffects('tiles', tileset, [...effects, flatten], scene)).toThrow('CustomShader')
    expect(tileset.clippingPolygons).toBe(externalClipping); expect(tileset.customShader).toBe(externalShader)
    manager.removeEffects('tiles')
    expect(tileset.clippingPolygons).toBe(externalClipping); expect(tileset.customShader).toBe(externalShader)
    externalShader.destroy()
  })
})
