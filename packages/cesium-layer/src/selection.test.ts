import { describe, expect, it, vi } from 'vitest'
import { Cartesian3, Cesium3DTileStyle, Color, Cesium3DTileColorBlendMode, ColorBlendMode, Entity, JulianDate, KeyboardEventModifier, ScreenSpaceEventType } from 'cesium'
import type { Model, Viewer } from 'cesium'
import { BaseLayer, LayerCollection, ModelLayer, TilesetLayer } from './index'

const actions = vi.hoisted(() => new Map<string, (event: unknown) => void>())
vi.mock('cesium', async original => ({ ...await original<typeof import('cesium')>(), ScreenSpaceEventHandler: class {
  setInputAction(action: (event: unknown) => void, type: number, modifier?: number): void { actions.set(`${type}:${modifier ?? ''}`, action) }
  destroy(): void {}
} }))

describe('prepared layer adoption', () => {
  it('validates every candidate before replacing mounted layers and retains shared layers', async () => {
    const viewer = { canvas: {}, isDestroyed: () => false, scene: { requestRender: vi.fn() } } as unknown as Viewer
    class PreparedLayer extends BaseLayer {
      readonly release = vi.fn()
      contains(): boolean { return false }
      async flyTo(): Promise<void> {}
      protected setNativeVisible(): void {}
      protected async createNative(): Promise<() => void> { return this.release }
    }
    const collection = new LayerCollection(viewer)
    const old = new PreparedLayer({ id: 'old' }), shared = new PreparedLayer({ id: 'shared' })
    await collection.addLayer(old); await collection.addLayer(shared)
    const next = new PreparedLayer({ id: 'next' }), unmounted = new PreparedLayer({ id: 'unmounted' })
    await next.mount(viewer)
    expect(() => collection.replaceMountedLayers([next, unmounted])).toThrow()
    expect(collection.layers).toEqual([old, shared])
    expect(old.release).not.toHaveBeenCalled()
    const duplicate = new PreparedLayer({ id: 'next' })
    await duplicate.mount(viewer)
    expect(() => collection.replaceMountedLayers([next, duplicate])).toThrow()
    expect(collection.layers).toEqual([old, shared])
    const otherViewer = { ...viewer } as Viewer
    const foreign = new PreparedLayer({ id: 'foreign' })
    await foreign.mount(otherViewer)
    expect(() => collection.replaceMountedLayers([foreign])).toThrow()
    expect(collection.layers).toEqual([old, shared])
    collection.replaceMountedLayers([shared, next])
    expect(collection.layers).toEqual([shared, next])
    expect(old.release).toHaveBeenCalledOnce()
    expect(shared.release).not.toHaveBeenCalled()
    expect(next.isMountedOn(viewer)).toBe(true)
    collection.destroy(); duplicate.destroy(); foreign.destroy(); old.destroy(); unmounted.destroy()
    expect(next.release).toHaveBeenCalledOnce()
    expect(shared.release).toHaveBeenCalledOnce()
  })
})

describe('independent layer selection', () => {
  it('reads detached native diagnostics and trims only the engine cache', () => {
    const tiles = new TilesetLayer({ id: 'city', url: './scene3d.json' })
    const trimLoadedTiles = vi.fn()
    tiles.tileset = { style: undefined, trimLoadedTiles, maximumScreenSpaceError: 4, cacheBytes: 100, totalMemoryUsageInBytes: 200, tilesLoaded: true } as typeof tiles.tileset
    tiles.setStyle({ color: 'color("red")' })
    const presentation = tiles.getPresentation()!
    expect(presentation).toMatchObject({ maximumScreenSpaceError: 4, cacheBytes: 100, totalMemoryUsageInBytes: 200, style: { color: 'color("red")' } })
    Object.assign(presentation.style!, { color: 'color("blue")' })
    tiles.trimLoadedTiles()
    expect(trimLoadedTiles).toHaveBeenCalledOnce()
    expect(tiles.getPresentation()?.style).toEqual({ color: 'color("red")' })
    expect(tiles.getTransform().translation).toEqual([0, 0, 0])
  })
  it('forwards normal/Ctrl/Shift selection while respecting picking and visibility guards', async () => {
    const entity = new Entity({ properties: { name: 'Actual name' } }), picked = { id: entity }
    const viewer = { canvas: {}, isDestroyed: () => false, scene: { pick: () => picked, requestRender: vi.fn() }, camera: { pickEllipsoid: () => Cartesian3.fromDegrees(116,39,0) }, clock: { currentTime: JulianDate.now() } } as unknown as Viewer
    class TestLayer extends BaseLayer {
      contains(value: unknown): boolean { return value === picked }
      async flyTo(): Promise<void> {}
      protected setNativeVisible(): void {}
      protected async createNative(): Promise<() => void> { return () => {} }
    }
    const collection = new LayerCollection(viewer), layer = new TestLayer({ id: 'p' }), clicks: Array<string | undefined> = []
    collection.popupsEnabled = false; await collection.addLayer(layer)
    layer.on('click', event => { clicks.push(event.selection); expect(event.properties.name).toBe('Actual name') })
    for (const modifier of [undefined, KeyboardEventModifier.CTRL, KeyboardEventModifier.SHIFT]) actions.get(`${ScreenSpaceEventType.LEFT_CLICK}:${modifier ?? ''}`)?.({ position: {} })
    expect(clicks).toEqual([undefined, 'toggle', 'range'])
    collection.pickingEnabled = false; actions.get(`${ScreenSpaceEventType.LEFT_CLICK}:`)?.({ position: {} }); expect(clicks).toHaveLength(3)
    collection.pickingEnabled = true; layer.show = false; actions.get(`${ScreenSpaceEventType.LEFT_CLICK}:`)?.({ position: {} }); expect(clicks).toHaveLength(3)
    collection.destroy()
  })
  it('restores tileset styles and model colors exactly after transient highlighting', () => {
    const tiles = new TilesetLayer({ id: 'city', url: './scene3d.json' }), style = new Cesium3DTileStyle({ color: 'color("red")' })
    tiles.tileset = { style, colorBlendMode: Cesium3DTileColorBlendMode.HIGHLIGHT, colorBlendAmount: .5 } as typeof tiles.tileset
    tiles.setHighlighted(true); const highlight = tiles.tileset?.style
    expect(highlight).not.toBe(style); tiles.setHighlighted(true); expect(tiles.tileset?.style).toBe(highlight)
    expect(tiles.tileset?.colorBlendMode).toBe(Cesium3DTileColorBlendMode.MIX); expect(tiles.tileset?.colorBlendAmount).toBe(.2)
    tiles.setHighlighted(false); expect(tiles.tileset?.style).toBe(style)
    expect(tiles.tileset?.colorBlendMode).toBe(Cesium3DTileColorBlendMode.HIGHLIGHT); expect(tiles.tileset?.colorBlendAmount).toBe(.5)
    const model = new ModelLayer({ id: 'model', url: './model.glb', position: [116,39,0] })
    model.model = { color: Color.RED, colorBlendMode: ColorBlendMode.REPLACE, colorBlendAmount: .2 } as Model
    model.setHighlighted(true); expect(model.model.color).not.toEqual(Color.RED)
    model.setHighlighted(true); model.setHighlighted(false)
    expect(model.model.color).toEqual(Color.RED); expect(model.model.colorBlendMode).toBe(ColorBlendMode.REPLACE); expect(model.model.colorBlendAmount).toBe(.2)
  })
  it('keeps the latest persistent style across highlighting and rejects a failed native assignment', () => {
    const tiles = new TilesetLayer({ id: 'city', url: './scene3d.json' })
    const original = new Cesium3DTileStyle({ color: 'color("red")' }), current = new Cesium3DTileStyle({ color: 'color("green")' })
    let style: Cesium3DTileStyle | undefined = original
    Object.defineProperties((tiles.tileset = { colorBlendMode: Cesium3DTileColorBlendMode.HIGHLIGHT, colorBlendAmount: .5 } as typeof tiles.tileset), {
      style: { get: () => style, set: value => { if (value?.color?.expression === 'color("blue")') throw new Error('native assignment rejected'); style = value } }
    })
    tiles.setHighlighted(true)
    tiles.setStyle({ color: 'color("green")' })
    expect(style).not.toBe(current)
    expect(() => tiles.setStyle({ color: 'color("blue")' })).toThrow('应用 3D Tiles Style 失败')
    tiles.setHighlighted(false)
    expect(style).toBeDefined()
    expect(style?.color.expression).toBe('color("green")')
    expect(tiles.tileset?.colorBlendMode).toBe(Cesium3DTileColorBlendMode.HIGHLIGHT)
  })
  it('preflights loaded and nested content features before replacing the active style', () => {
    const tiles = new TilesetLayer({ id: 'city', url: './scene3d.json' })
    const makeFeature = (properties: Record<string, unknown>) => ({
      getProperty: (name: string) => properties[name],
      getPropertyInherited: (name: string) => properties[name],
      hasProperty: (name: string) => name in properties,
      getPropertyIds: () => Object.keys(properties)
    })
    const content = (features: unknown[]) => ({ featuresLength: features.length, getFeature: (index: number) => features[index] })
    const existing = new Cesium3DTileStyle({ color: 'color("green")' })
    const good = content([makeFeature({ Height: 40 }), makeFeature({ Height: 12 })])
    const missing = content([makeFeature({ Name: 'no height' })])
    tiles.tileset = { style: existing, root: { content: { innerContents: [good, missing] }, children: [] } } as unknown as typeof tiles.tileset
    expect(() => tiles.validateStyle({ defines: { height: '${Height}' }, color: { conditions: [['${height} > 30', 'color("red")'], ['true', 'color("white")']] } })).toThrow('无法应用')
    expect(() => tiles.setStyle({ color: 'color("blue")' })).not.toThrow()
    expect(tiles.tileset?.style?.color.expression).toBe('color("blue")')
  })
  it('restores the previous compatible style before a new incompatible tile is styled', () => {
    const tiles = new TilesetLayer({ id: 'city', url: './scene3d.json' })
    const listeners = new Map<string, (event: unknown) => void>()
    const valid = { getProperty: (name: string) => name === 'Height' ? 40 : undefined, getPropertyInherited: (name: string) => name === 'Height' ? 40 : undefined, hasProperty: (name: string) => name === 'Height', getPropertyIds: () => ['Height'] }
    const tileLoad = { addEventListener: (listener: (tile: unknown) => void) => { listeners.set('tileLoad', listener); return () => listeners.delete('tileLoad') } }
    const tileFailed = { addEventListener: () => () => {} }
    const tileset = {
      style: undefined, modelMatrix: undefined, boundingSphere: { center: Cartesian3.fromDegrees(0, 0) }, show: true,
      tileLoad, tileFailed, root: { content: { featuresLength: 1, getFeature: () => valid }, children: [] },
      colorBlendMode: Cesium3DTileColorBlendMode.HIGHLIGHT, colorBlendAmount: 0,
      isDestroyed: () => false, destroy: vi.fn()
    }
    const viewer = { isDestroyed: () => false, scene: { primitives: { add: (value: unknown) => value, remove: () => true }, requestRender: vi.fn() } } as unknown as Viewer
    tiles.tileset = tileset as unknown as typeof tiles.tileset
    tiles.setStyle({ color: 'color("green")' })
    tiles.setStyle({ color: '${Height} > 0 ? color("red") : color("white")' })
    const errors: Error[] = []
    tiles.on('error', error => errors.push(error))
    const missing = { getProperty: () => undefined, getPropertyInherited: () => undefined, hasProperty: () => false, getPropertyIds: () => [] }
    listeners.get('tileLoad')?.({ content: { featuresLength: 1, getFeature: () => missing } })
    expect(tiles.tileset?.style?.color.expression).toBe('color("green")')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('新加载')
  })
})
