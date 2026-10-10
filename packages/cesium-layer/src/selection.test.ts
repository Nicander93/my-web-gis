import { describe, expect, it, vi } from 'vitest'
import { Cartesian3, Cesium3DTileStyle, Color, Cesium3DTileColorBlendMode, ColorBlendMode, Entity, JulianDate, KeyboardEventModifier, ScreenSpaceEventType } from 'cesium'
import type { Model, Viewer } from 'cesium'
import { BaseLayer, LayerCollection, ModelLayer, TilesetLayer } from './index'

const actions = vi.hoisted(() => new Map<string, (event: unknown) => void>())
vi.mock('cesium', async original => ({ ...await original<typeof import('cesium')>(), ScreenSpaceEventHandler: class {
  setInputAction(action: (event: unknown) => void, type: number, modifier?: number): void { actions.set(`${type}:${modifier ?? ''}`, action) }
  destroy(): void {}
} }))

describe('independent layer selection', () => {
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
    const tiles = new TilesetLayer({ id: 'city', url: './city.json' }), style = new Cesium3DTileStyle({ color: 'color("red")' })
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
})
