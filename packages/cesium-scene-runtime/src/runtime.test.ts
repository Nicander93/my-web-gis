import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EntityCollection, JulianDate } from 'cesium'
import type { Viewer } from 'cesium'
import { createCityScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { CitySceneRuntime, createCesiumDocumentRuntime } from './index'
import { migrateSceneDocument } from '@desktop-webgis/scene-schema'

const probe = vi.hoisted(() => ({ created: 0, released: 0, nativeGate: undefined as Promise<void> | undefined, editors: [] as Array<{ stopEditing: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }> }))
vi.mock('cesium', async original => ({ ...await original<typeof import('cesium')>(),
  ScreenSpaceEventHandler: class { setInputAction(): void {} destroy(): void {} },
  Resource: class { constructor(readonly options: { url: string }) {} },
  EllipsoidTerrainProvider: class {},
  buildModuleUrl: () => 'https://local.test/cesium/Assets/Textures/NaturalEarthII',
  TileMapServiceImageryProvider: { fromUrl: async () => { await preparationProbe.environment; return {} } }
}))
vi.mock('@desktop-webgis/cesium-layer', async original => {
  const actual = await original<typeof import('@desktop-webgis/cesium-layer')>()
  return { ...actual, TilesetLayer: class extends actual.TilesetLayer {
    protected async createNative(): Promise<() => void> { probe.created++; preparationProbe.visibility.push(this.show); await (preparationProbe.gates.length ? preparationProbe.gates.shift() : probe.nativeGate); return () => { probe.released++ } }
  }, GeoJsonLayer: class extends actual.GeoJsonLayer {
    protected async createNative(): Promise<() => void> { return () => {} }
  } }
})
vi.mock('@desktop-webgis/cesium-tileset-edit', () => ({ TilesetEditor: class {
  stopEditing = vi.fn(); cancel = vi.fn()
  constructor(_viewer: Viewer, private options: { onStart(): void }) { probe.editors.push(this) }
  startEditing(): void { this.options.onStart() } setMode(): void {} refresh(): void {} destroy(): void {}
} }))
beforeEach(() => { probe.created = 0; probe.released = 0; probe.nativeGate = undefined; probe.editors = []; vi.stubGlobal('document', { baseURI: 'https://local.test/' }); vi.stubGlobal('CESIUM_BASE_URL', 'https://local.test/cesium/') })
afterEach(() => vi.unstubAllGlobals())
const preparationProbe = vi.hoisted(() => ({ gates: [] as Promise<void>[], visibility: [] as boolean[], environment: undefined as Promise<void> | undefined }))
beforeEach(() => { preparationProbe.gates = []; preparationProbe.visibility = []; preparationProbe.environment = undefined })
function setup() {
  const scene = createCityScene()
  scene.assets.blocks = { type: '3dtiles', url: './city/tileset.json' }
  scene.nodes.push({ id: 'blocks', name: 'Blocks', type: '3dtiles', asset: 'blocks', visible: true, transform: createTransform() })
  const viewer = { canvas: {}, isDestroyed: () => false, destroy: vi.fn(), camera: { setView: vi.fn() }, scene: { requestRender: vi.fn(), fog: { density: 0, enabled: false }, postProcessStages: { bloom: { enabled: false } } }, imageryLayers: { addImageryProvider: vi.fn(), remove: vi.fn() } } as unknown as Viewer
  return { scene, viewer, runtime: new CitySceneRuntime(viewer, { target: 'map', scene }) }
}
describe('incremental scene reconciliation', () => {
  it('awaits a reused loading resource and applies latest visibility without loading twice', async () => {
    let release!: () => void
    probe.nativeGate = new Promise(resolve => { release = resolve })
    const s = setup()
    const first = s.runtime.updateScene(s.scene)
    s.scene.nodes[0].visible = false
    let settled = false
    const second = s.runtime.updateScene(s.scene).then(() => { settled = true })
    await Promise.resolve(); await Promise.resolve()
    expect(settled).toBe(false)
    expect(probe.created).toBe(1)
    release(); await Promise.all([first, second])
    expect(s.runtime.layers.getLayer('blocks')?.show).toBe(false)
    s.runtime.destroy()
  })
  it('ignores a removed resource failure and allows a failed current resource to retry', async () => {
    let reject!: (error: Error) => void
    probe.nativeGate = new Promise((_resolve, fail) => { reject = fail })
    const s = setup()
    const first = s.runtime.updateScene(s.scene)
    const empty = { ...s.scene, nodes: [] }
    await s.runtime.updateScene(empty)
    reject(new Error('late removed request'))
    await expect(first).resolves.toBeUndefined()
    expect(s.runtime.layers.getLayer('blocks')).toBeUndefined()
    probe.nativeGate = Promise.reject(new Error('current request'))
    await expect(s.runtime.updateScene(s.scene)).rejects.toThrow('current request')
    probe.nativeGate = undefined
    await s.runtime.updateScene(s.scene)
    expect(s.runtime.layers.getLayer('blocks')?.state).toBe('ready')
    s.runtime.destroy()
  })
  it('updates tileset quality in place without downloading a new resource', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene)
    const layer = s.runtime.layers.getLayer('blocks') as import('@desktop-webgis/cesium-layer').TilesetLayer
    const quality = vi.spyOn(layer, 'setQuality')
    const node = s.scene.nodes[0]
    if (node.type === '3dtiles') { node.maximumScreenSpaceError = 2; node.cacheBytes = 512 * 1024 * 1024 }
    await s.runtime.updateScene(s.scene)
    expect(quality).toHaveBeenLastCalledWith(2, 512 * 1024 * 1024)
    expect(s.runtime.layers.getLayer('blocks')).toBe(layer)
    expect(probe.created).toBe(1)
    s.runtime.destroy()
  })
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
  it('releases runtime layers but retains an explicitly caller-owned viewer', async () => {
    const s = setup()
    s.runtime.destroy()
    vi.mocked(s.viewer.destroy).mockClear()
    const runtime = new CitySceneRuntime(s.viewer, { target: 'map', scene: s.scene, ownsViewer: false })
    await runtime.updateScene(s.scene)
    const before = probe.released
    runtime.destroy(); runtime.destroy()
    expect(probe.released).toBe(before + 1)
    expect(s.viewer.destroy).not.toHaveBeenCalled()
  })
  it('loads v3 content into a caller viewer, retains full definitions and restores host environment', async () => {
    const s = setup(); s.runtime.destroy(); vi.mocked(s.viewer.destroy).mockClear()
    s.viewer.camera = { setView: vi.fn() } as unknown as Viewer['camera']
    s.viewer.scene.globe = { enableLighting: false } as Viewer['scene']['globe']
    const originalTime = JulianDate.fromIso8601('2026-01-01T00:00:00Z')
    s.viewer.clock = { currentTime: originalTime } as Viewer['clock']
    s.scene.lighting = { sunlight: true, shadows: true, time: '2026-02-01T00:00:00Z' }
    const document = migrateSceneDocument(s.scene)
    document.resources.base = { type: 'xyz', url: 'https://example.test/{z}/{x}/{y}.png' }
    document.nodes.push({ type: 'tile', id: 'map', name: 'Map', resource: 'base' })
    const loaded = await createCesiumDocumentRuntime({ document, viewer: s.viewer })
    expect(loaded.runtime.layers.getLayer('blocks')?.state).toBe('ready')
    expect(loaded.getDocument()).toEqual(document)
    expect(loaded.issues).toContainEqual(expect.objectContaining({ code: 'cesium.unsupported' }))
    expect(s.viewer.scene.globe.enableLighting).toBe(true)
    loaded.destroy(); loaded.destroy()
    expect(s.viewer.scene.globe.enableLighting).toBe(false)
    expect(JulianDate.equals(s.viewer.clock.currentTime, originalTime)).toBe(true)
    expect(s.viewer.destroy).not.toHaveBeenCalled()
  })
})

describe('prepared scene replacement', () => {
  it('keeps old content while candidates load hidden, then adopts them without a second load', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene)
    const previous = s.runtime.layers.getLayer('blocks'), terrain = s.viewer.terrainProvider
    const incoming = structuredClone(s.scene); incoming.effects.fog = 0.1
    let release!: () => void
    probe.nativeGate = new Promise(resolve => { release = resolve })
    const pending = s.runtime.replaceScene(incoming)
    expect(preparationProbe.visibility.at(-1)).toBe(false)
    expect(s.runtime.layers.getLayer('blocks')).toBe(previous)
    expect(s.viewer.terrainProvider).toBe(terrain)
    expect(s.viewer.scene.fog.density).toBe(0)
    release(); await pending
    expect(s.runtime.layers.getLayer('blocks')).not.toBe(previous)
    expect(s.runtime.layers.getLayer('blocks')?.show).toBe(true)
    expect(probe.created).toBe(2)
    expect(probe.released).toBe(1)
    expect(s.viewer.scene.fog.density).toBe(0.0002)
    s.runtime.destroy()
  })

  it('releases partially prepared candidates when another resource fails and leaves the old scene intact', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene)
    const previous = s.runtime.layers.getLayer('blocks')
    const incoming = structuredClone(s.scene)
    incoming.nodes.push({ ...incoming.nodes[0], id: 'second' })
    preparationProbe.gates = [Promise.resolve(), Promise.reject(new Error('Missing resource'))]
    await expect(s.runtime.replaceScene(incoming)).rejects.toThrow('Missing resource')
    expect(s.runtime.layers.layers).toEqual([previous])
    expect(previous?.state).toBe('ready')
    expect(probe.released).toBe(1)
    s.runtime.destroy()
  })

  it('does not change environment or camera on preparation failure', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene)
    const previous = s.runtime.layers.getLayer('blocks'), terrain = s.viewer.terrainProvider
    const incoming = structuredClone(s.scene); incoming.effects.fog = 0.2
    preparationProbe.environment = Promise.reject(new Error('Environment unavailable'))
    await expect(s.runtime.replaceScene(incoming)).rejects.toThrow('Environment unavailable')
    expect(s.runtime.layers.getLayer('blocks')).toBe(previous)
    expect(s.viewer.terrainProvider).toBe(terrain)
    expect(s.viewer.scene.fog.density).toBe(0)
    expect(s.viewer.camera.setView).not.toHaveBeenCalled()
    s.runtime.destroy()
  })

  it('rejects obsolete resources after a newer replacement commits', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene)
    let release!: () => void
    probe.nativeGate = new Promise(resolve => { release = resolve })
    const first = s.runtime.replaceScene(s.scene)
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    probe.nativeGate = undefined
    const next = { ...s.scene, nodes: [], effects: { fog: 0.3, bloom: false } }
    await s.runtime.replaceScene(next)
    release(); await rejected
    expect(s.runtime.layers.layers).toEqual([])
    expect(s.viewer.scene.fog.density).toBe(0.0006)
    expect(probe.released).toBe(2)
    s.runtime.destroy()
  })

  it('retains the latest legacy edit when it cancels a pending replacement', async () => {
    const s = setup(); await s.runtime.updateScene(s.scene)
    const previous = s.runtime.layers.getLayer('blocks')
    let release!: () => void
    probe.nativeGate = new Promise(resolve => { release = resolve })
    const pending = s.runtime.replaceScene(s.scene)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    s.scene.nodes[0].visible = false
    await s.runtime.updateScene(s.scene)
    release(); await rejected
    expect(s.runtime.layers.getLayer('blocks')).toBe(previous)
    expect(previous?.show).toBe(false)
    s.runtime.destroy()
  })

  it('releases late candidates after external cancellation or destruction', async () => {
    for (const destroy of [false, true]) {
      const s = setup(); await s.runtime.updateScene(s.scene)
      const previous = s.runtime.layers.getLayer('blocks')
      let release!: () => void
      probe.nativeGate = new Promise(resolve => { release = resolve })
      const abort = new AbortController(), pending = s.runtime.replaceScene(s.scene, abort.signal)
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      if (destroy) s.runtime.destroy(); else abort.abort()
      release(); await rejected
      if (!destroy) expect(s.runtime.layers.getLayer('blocks')).toBe(previous)
      s.runtime.destroy(); probe.nativeGate = undefined
    }
  })
})
