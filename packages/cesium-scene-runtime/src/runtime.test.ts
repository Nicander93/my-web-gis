import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  } }
})
vi.mock('@desktop-webgis/cesium-tileset-edit', () => ({ TilesetEditor: class {
  stopEditing = vi.fn(); cancel = vi.fn()
  constructor() { probe.editors.push(this) }
  startEditing(): void {} setMode(): void {} refresh(): void {} destroy(): void {}
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
