import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntityCollection, JulianDate } from 'cesium'
import type { Viewer } from 'cesium'
import { createCityScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { CitySceneRuntime } from './index'

const probe = vi.hoisted(() => ({ created: 0, released: 0, editors: [] as Array<{ stopEditing: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> }))
vi.mock('cesium', async original => ({ ...await original<typeof import('cesium')>(),
  ScreenSpaceEventHandler: class { setInputAction(): void {} destroy(): void {} },
  Resource: class { constructor(readonly options: { url: string }) {} },
  EllipsoidTerrainProvider: class {},
  buildModuleUrl: () => 'https://local.test/cesium/Assets/Textures/NaturalEarthII',
  TileMapServiceImageryProvider: { fromUrl: async () => ({}) }
}))
vi.mock('@desktop-webgis/cesium-layer', async original => {
  const actual = await original<typeof import('@desktop-webgis/cesium-layer')>()
  return { ...actual, TilesetLayer: class extends actual.TilesetLayer {
    protected async createNative(): Promise<() => void> { probe.created++; return () => { probe.released++ } }
  }, GeoJsonLayer: class extends actual.GeoJsonLayer {
    protected async createNative(): Promise<() => void> { return () => {} }
  } }
})
vi.mock('@desktop-webgis/cesium-tileset-edit', () => ({ TilesetEditor: class {
  stopEditing = vi.fn(); cancel = vi.fn()
  constructor(_viewer: Viewer, private options: { onStart(): void }) { probe.editors.push(this) }
  startEditing(): void { this.options.onStart() } setMode(): void {} refresh(): void {} destroy(): void {}
} }))
beforeEach(() => { probe.created = 0; probe.released = 0; probe.editors = []; vi.stubGlobal('document', { baseURI: 'https://local.test/' }); vi.stubGlobal('CESIUM_BASE_URL', 'https://local.test/cesium/') })
afterEach(() => vi.unstubAllGlobals())
function setup() {
  const scene = createCityScene()
  scene.assets.blocks = { type: '3dtiles', url: './city/tileset.json' }
  scene.nodes.push({ id: 'blocks', name: 'Blocks', type: '3dtiles', asset: 'blocks', visible: true, transform: createTransform() })
  const viewer = { canvas: {}, isDestroyed: () => false, destroy: vi.fn(), scene: { requestRender: vi.fn(), fog: { density: 0, enabled: false }, postProcessStages: { bloom: { enabled: false } } }, imageryLayers: { addImageryProvider: vi.fn(), remove: vi.fn() } } as unknown as Viewer
  return { scene, viewer, runtime: new CitySceneRuntime(viewer, { target: 'map', scene }) }
}
describe('incremental scene reconciliation', () => {
  it('keeps vector selection after style updates and restores the latest scene color', async () => {
    const s = setup()
    s.scene.assets.roads = { type: 'geojson', url: './roads.geojson' }
    s.scene.nodes.push({ id: 'roads', name: 'Roads', type: 'geojson', asset: 'roads', visible: true, color: '#336699' })
    await s.runtime.updateScene(s.scene)
    const layer = s.runtime.layers.getLayer('roads') as import('@desktop-webgis/cesium-layer').GeoJsonLayer
    const color = vi.spyOn(layer, 'setColor')
    s.runtime.setSelected(['roads'])
    const node = s.scene.nodes[1]; if (node.type === 'geojson') node.color = '#ff0000'
    await s.runtime.updateScene(s.scene)
    expect(color).toHaveBeenLastCalledWith('#3984d7')
    s.runtime.setSelected([]); expect(color).toHaveBeenLastCalledWith('#ff0000')
    expect(s.runtime.layers.getLayer('roads')).toBe(layer)
    s.runtime.destroy()
  })
  it('applies inherited group visibility and locking without reloading resources', async () => {
    const s = setup(); s.scene.groups = [{ id: 'g', name: '城市', visible: true }]; s.scene.nodes[0].groupId = 'g'
    await s.runtime.updateScene(s.scene); const layer = s.runtime.layers.getLayer('blocks')
    s.scene.groups[0].visible = false; await s.runtime.updateScene(s.scene)
    expect(layer?.show).toBe(false); expect(s.scene.nodes[0].visible).toBe(true)
    expect(() => s.runtime.startEditing('blocks')).toThrow('隐藏')
    s.scene.groups[0].visible = true; s.scene.groups[0].locked = true; await s.runtime.updateScene(s.scene)
    expect(layer?.show).toBe(true); expect(() => s.runtime.startEditing('blocks')).toThrow('锁定')
    s.scene.groups[0].locked = false; s.scene.nodes[0].groupId = undefined; await s.runtime.updateScene(s.scene)
    s.runtime.startEditing('blocks'); expect(probe.created).toBe(1); expect(s.runtime.layers.getLayer('blocks')).toBe(layer)
    s.runtime.destroy()
  })
  it('cancels vertex previews when switching to drawing or receiving authoritative geometry', async () => {
    const s = setup()
    s.viewer.entities = new EntityCollection()
    s.viewer.dataSources = { add: vi.fn(async source => source), remove: vi.fn() } as unknown as Viewer['dataSources']
    s.scene.nodes.push({ id: 'p', name: 'Point', type: 'graphic', visible: true, geometry: { type: 'point', heightMode: 'ground', positions: [[116,39,0]] }, style: { color: '#336699', width: 3, pointSize: 10 }, properties: {} })
    await s.runtime.updateScene(s.scene)
    const editing = s.runtime.startGraphicEditing('p'); editing.setVertexPosition(0, [117,39,0])
    expect(s.scene.nodes[1].type === 'graphic' && s.scene.nodes[1].geometry.positions[0][0]).toBe(116)
    const drawing = s.runtime.startDraw({ type: 'polygon' })
    await expect(editing.result).resolves.toEqual({ status: 'cancelled' }); expect(s.runtime.layers.pickingEnabled).toBe(false)
    s.runtime.cancelDraw(); await drawing.result
    const second = s.runtime.startGraphicEditing('p'); second.setVertexPosition(0, [118,39,0])
    const node = s.scene.nodes[1]; if (node.type === 'graphic') node.geometry.positions[0] = [115,39,0]
    await s.runtime.updateScene(s.scene)
    await expect(second.result).resolves.toEqual({ status: 'cancelled' })
    const third = s.runtime.startGraphicEditing('p'); expect(third.state.geometry.positions[0][0]).toBe(115)
    s.runtime.setPreview(true); await expect(third.result).resolves.toEqual({ status: 'cancelled' })
    expect(s.viewer.entities.values).toHaveLength(0); expect(s.runtime.layers.pickingEnabled).toBe(true)
    s.runtime.destroy()
  })
  it('switches draw to model editing without a late cancellation restoring picking', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene)
    const drawing = s.runtime.startDraw({ type: 'polygon' })
    expect(s.runtime.layers.pickingEnabled).toBe(false)
    s.runtime.startEditing('blocks')
    await expect(drawing.result).resolves.toEqual({ status: 'cancelled' })
    expect(s.runtime.layers.pickingEnabled).toBe(false)
    s.runtime.setPreview(true)
    expect(s.runtime.layers.popupsEnabled).toBe(true)
    expect(s.runtime.layers.pickingEnabled).toBe(true)
    s.runtime.setPreview(false); expect(s.runtime.layers.popupsEnabled).toBe(false)
    s.scene.nodes[0].locked = true; await s.runtime.updateScene(s.scene)
    expect(() => s.runtime.startEditing('blocks')).toThrow('锁定')
    expect(probe.created).toBe(1)
    s.scene.nodes[0].name = 'Renamed'; await s.runtime.updateScene(s.scene)
    expect(s.runtime.layers.getLayer('blocks')?.name).toBe('Renamed')
    expect(probe.created).toBe(1)
    s.runtime.destroy()
  })
  it('reuses graphic resources for style updates and restores baseline lighting on undo', async () => {
    const s = setup()
    s.viewer.dataSources = { add: vi.fn(async source => source), remove: vi.fn() } as unknown as Viewer['dataSources']
    s.viewer.entities = new EntityCollection()
    s.viewer.scene.globe = { enableLighting: false } as Viewer['scene']['globe']
    s.viewer.clock = { currentTime: JulianDate.fromIso8601('2026-10-04T00:00:00Z') } as Viewer['clock']
    s.scene.nodes.push({ id: 'p', name: 'Point', type: 'graphic', visible: true, geometry: { type: 'point', heightMode: 'ground', positions: [[116,39,0]] }, style: { color: '#336699', width: 3, pointSize: 10 }, properties: {} })
    await s.runtime.updateScene(s.scene)
    const layer = s.runtime.layers.getLayer('p')
    const graphic = s.scene.nodes[1]; if (graphic.type === 'graphic') graphic.style.color = '#ff0000'
    s.scene.lighting = { sunlight: true, shadows: true, time: '2026-10-04T12:00:00Z' }
    await s.runtime.updateScene(s.scene)
    expect(s.runtime.layers.getLayer('p')).toBe(layer)
    expect(s.viewer.dataSources.add).toHaveBeenCalledOnce()
    expect(s.viewer.scene.globe.enableLighting).toBe(true)
    expect(s.viewer.shadows).toBe(true)
    s.scene.lighting = undefined; await s.runtime.updateScene(s.scene)
    expect(s.viewer.scene.globe.enableLighting).toBe(false)
    expect(s.viewer.shadows).toBe(false)
    s.runtime.destroy()
    expect(s.viewer.dataSources.remove).toHaveBeenCalledOnce()
  })
  it('reuses the loaded tileset for transforms and cancels gestures on authoritative updates', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene)
    const original = s.runtime.layers.getLayer('blocks')
    const node = s.scene.nodes[0]; if (node.type === '3dtiles') node.transform.translation = [25,0,0]
    await s.runtime.updateScene(s.scene)
    expect(probe.created).toBe(1); expect(s.runtime.layers.getLayer('blocks')).toBe(original)
    expect(probe.editors[0].cancel).toHaveBeenCalledTimes(2)
    s.runtime.destroy(); expect(probe.released).toBe(1)
  })
  it('releases changed resources and supports explicit retry after removal', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene)
    s.scene.assets.blocks.url = './replacement/tileset.json'; await s.runtime.updateScene(s.scene)
    expect(probe.created).toBe(2); expect(probe.released).toBe(1)
    s.runtime.layers.removeLayer('blocks'); await s.runtime.updateScene(s.scene)
    expect(probe.created).toBe(3); expect(probe.released).toBe(2)
    s.runtime.destroy()
  })
  it('stops editing a hidden layer and destroys the owned viewer once', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene); s.runtime.startEditing('blocks')
    s.scene.nodes[0].visible = false; await s.runtime.updateScene(s.scene)
    expect(probe.editors[0].stopEditing).toHaveBeenCalledOnce()
    expect(() => s.runtime.startEditing('blocks')).toThrow('隐藏')
    s.runtime.destroy(); s.runtime.destroy(); expect(s.viewer.destroy).toHaveBeenCalledOnce()
  })
})
