import * as Cesium from 'cesium'
import { describe, expect, it, vi } from 'vitest'
import { generateOpenLayersModule } from './index.js'
import { generateCesiumModule, inspectCesiumCodegenCapabilities } from './index.js'

describe('OpenLayers code generation', () => {
  it('embeds a validated scene and runtime credential references without secrets', () => {
    const code = generateOpenLayersModule({
      version: 1,
      id: 'report',
      title: 'Report',
      view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
      credentials: { tianditu: { type: 'runtime-reference', key: 'TDT_TOKEN' } },
      sources: {
        base: {
          type: 'provider',
          provider: 'tianditu',
          mapType: 'vector',
          credential: 'tianditu'
        }
      },
      layers: [{ id: 'base', name: 'Base', type: 'tile', source: 'base' }]
    })

    expect(code).toContain("createSceneRuntime")
    expect(code).toContain('globalThis["__MAP_CREDENTIALS__"]')
    expect(code).toContain('"tianditu"')
    expect(code).not.toContain('secret-token')
  })


  it('preserves categorized styles in generated modules (no silent downgrade)', () => {
    const code = generateOpenLayersModule({
      version: 2,
      id: 'cats',
      title: 'Cats',
      view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
      sources: {
        places: { type: 'geojson', url: './data/places.geojson' }
      },
      layers: [
        {
          id: 'places',
          name: 'Places',
          type: 'vector',
          source: 'places',
          style: {
            mode: 'categorized',
            field: 'status',
            categories: [
              {
                value: 'open',
                symbol: { type: 'circle', radius: 6, fill: { r: 0, g: 160, b: 0, a: 1 } }
              }
            ],
            fallback: { type: 'circle', radius: 3, fill: { r: 90, g: 90, b: 90, a: 1 } }
          }
        }
      ]
    })

    expect(code).toContain('"version": 2')
    expect(code).toContain('"mode": "categorized"')
    expect(code).toContain('"field": "status"')
    expect(code).not.toContain('"type": "point"')
  })

  it('migrates legacy v1 scenes during codegen', () => {
    const code = generateOpenLayersModule({
      version: 1,
      id: 'legacy',
      title: 'Legacy',
      view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 },
      sources: {
        places: { type: 'geojson', url: './data/places.geojson' }
      },
      layers: [
        {
          id: 'places',
          name: 'Places',
          type: 'vector',
          source: 'places',
          style: { type: 'point', radius: 6, fill: '#2563eb' },
          label: { field: 'name', color: '#111111' }
        }
      ]
    } as never)

    expect(code).toContain('"version": 2')
    expect(code).toContain('"mode": "single"')
    expect(code).toContain('"field": "name"')
  })

})

const cesiumDocument = {
  version: 3, id: 'native', title: 'Native', resources: {}, nodes: [], activeView: 'main',
  views: { main: { type: '3d', camera: { position: [116, 39, 1200], heading: 10, pitch: -30, roll: 0 }, heightReference: 'ellipsoid' } }
}

describe('Cesium native code generation', () => {
  function loadGenerated(source: string, cesiumApi: typeof Cesium | Record<string, unknown> = Cesium) {
    const executable = source.replace("import * as Cesium from 'cesium';", '')
      .replace('export const targetCesiumVersion', 'const targetCesiumVersion')
      .replace('export async function createScene', 'async function createScene')
      .replace('export async function mountScene', 'async function mountScene')
      .concat('\nreturn { targetCesiumVersion, createScene, mountScene };')
    return new Function('Cesium', executable)(cesiumApi)
  }

  it('executes generated module setup against an isolated Cesium surface', async () => {
    const source = generateCesiumModule(cesiumDocument)
    expect(source).toContain("import * as Cesium from 'cesium';")
    expect(source).toContain('createScene(viewer, hooks = {})')
    const api = loadGenerated(source)
    const cameraCalls: unknown[] = []
    const result = await api.createScene({ camera: { setView: (value: unknown) => cameraCalls.push(value) } })
    expect(api.targetCesiumVersion).toBe('1.145.0')
    expect(cameraCalls).toHaveLength(1)
    expect(result.entities).toEqual([])
  })

  it('blocks unsupported nodes and removes session bridge URLs before output', () => {
    const invalid = { ...cesiumDocument, nodes: [{ id: 'water', name: 'Water', type: 'water', visible: true, boundary: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], height: 0, color: '#00aaff', amplitude: 1, frequency: 1, speed: 1 }] }
    expect(inspectCesiumCodegenCapabilities(invalid).some(item => item.code === 'node.water')).toBe(true)
    expect(() => generateCesiumModule(invalid)).toThrow('水面节点')
    const bridge = { ...cesiumDocument, resources: { model: { type: 'glb', url: 'http://webgis-resource.localhost/session/a.glb', reference: { kind: 'relative', path: 'assets/a.glb' } } } }
    expect(generateCesiumModule(bridge)).not.toContain('webgis-resource.localhost')
  })

  it('provides a self-contained mountScene entry point', async () => {
    let mountedContainer: unknown
    let destroyed = false
    class FakeViewer {
      camera = { setView() {} }
      scene = {}
      entities = { remove() {} }
      scenePrimitives = { remove() {} }
      dataSources = { remove() {} }
      imageryLayers = { remove() {} }
      constructor(container: unknown) { mountedContainer = container }
      isDestroyed() { return destroyed }
      destroy() { destroyed = true }
    }
    const cesiumApi = Object.assign(Object.create(Cesium), { Viewer: FakeViewer })
    const container = { id: 'mount-target' }
    const mounted = await loadGenerated(generateCesiumModule(cesiumDocument), cesiumApi).mountScene(container)
    expect(mountedContainer).toBe(container)
    expect(mounted.viewer).toBeInstanceOf(FakeViewer)
    mounted.destroy()
    expect(destroyed).toBe(true)
  })

  it('uses real Cesium graphics, native environment settings, and destroys only owned objects', async () => {
    const document = {
      ...cesiumDocument,
      environment: {
        effects: { fog: 0.17, bloom: true },
        lighting: { sunlight: true, shadows: true, time: '2026-10-23T04:00:00Z' }
      },
      nodes: [
        { id: 'visible-root', type: 'group', name: 'Visible', visible: true },
        { id: 'visible-child', type: 'group', name: 'Nested', visible: true, parentId: 'visible-root' },
        { id: 'hidden-grandparent', type: 'group', name: 'Hidden grandparent', visible: false },
        { id: 'hidden-root', type: 'group', name: 'Hidden parent', visible: true, parentId: 'hidden-grandparent' },
        { id: 'hidden-child', type: 'group', name: 'Nested hidden', visible: true, parentId: 'hidden-root' },
        { id: 'tiles-identity', name: 'Tiles identity', type: '3dtiles', visible: true, parentId: 'visible-child', resource: 'tiles-identity', transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } },
        { id: 'tiles-delta', name: 'Tiles delta', type: '3dtiles', visible: true, parentId: 'visible-child', resource: 'tiles-delta', transform: { translation: [12, -4, 6], rotation: [15, 0, 0], scale: 1.2 }, style: { color: "color('red')", show: 'true' }, maximumScreenSpaceError: 4, cacheBytes: 123_000_000, popup: { titleField: 'name', fields: [{ field: 'name' }, { field: 'height' }] } },
        { id: 'model-identity', name: 'Model identity', type: 'model', visible: true, parentId: 'visible-child', resource: 'model-identity', position: [116, 39, 20], transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } },
        { id: 'model-delta', name: 'Model delta', type: 'model', visible: true, parentId: 'visible-child', resource: 'model-delta', position: [116.1, 39.1, 30], transform: { translation: [2, 3, 4], rotation: [5, 0, 0], scale: 2 }, popup: { title: 'GLB model', fields: [{ field: 'name', label: 'Model' }] } },
        { id: 'hidden-model', name: 'Hidden model', type: 'model', visible: true, parentId: 'hidden-child', resource: 'model-identity', position: [116, 39, 20], transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } },
        { id: 'image', name: 'Image', type: 'imagery', visible: true, url: 'https://example.test/{z}/{x}/{y}.png', attribution: 'Example', opacity: 0.7 },
        { id: 'places', name: 'Places', type: 'geojson', visible: true, resource: 'places', color: '#336699', popup: { titleField: 'name', fields: [{ field: 'name', label: 'Name' }] } },
        { id: 'pin', name: 'Pin', type: 'graphic', visible: true, parentId: 'visible-child',
        geometry: { type: 'point', positions: [[116, 39, 0]], heightMode: 'absolute' },
        style: { color: '#ff0000', width: 2, pointSize: 8 }, properties: { name: 'A&B' }, popup: { title: 'Feature', fields: [{ field: 'name', label: 'Name' }] } },
        { id: 'line', name: 'Line', type: 'graphic', visible: true, parentId: 'visible-child',
        geometry: { type: 'polyline', positions: [[116, 39, 0], [116.01, 39.01, 10]], heightMode: 'ground' },
        style: { color: '#00aa00', width: 5, pointSize: 4 }, properties: {} }
      ],
      resources: {
        'tiles-identity': { type: '3dtiles', url: 'https://example.test/identity/tileset.json' },
        'tiles-delta': { type: '3dtiles', reference: { kind: 'relative', path: 'assets/delta/tileset.json' }, authentication: { mode: 'bearer', credential: 'tiles-delta' } },
        'model-identity': { type: 'glb', url: 'https://example.test/model.glb' },
        'model-delta': { type: 'glb', url: 'https://example.test/model-delta.glb' },
        places: { type: 'geojson', url: 'https://example.test/places.json' }
      },
      credentials: { 'tiles-delta': { type: 'runtime-reference', key: 'PRIVATE_API_KEY_NAME' } }
    }
    const tileOrigin = Cesium.Cartesian3.fromDegrees(116, 39, 0)
    const tilesets = {
      'https://example.test/identity/tileset.json': { boundingSphere: { center: tileOrigin }, modelMatrix: Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(5, 6, 7)), show: true },
      'https://example.test/delta/tileset.json': { boundingSphere: { center: tileOrigin }, modelMatrix: Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(8, 9, 10)), show: true }
    }
    const deltaBase = Cesium.Matrix4.clone(tilesets['https://example.test/delta/tileset.json'].modelMatrix)
    const loadedTilesetOptions: Array<Record<string, unknown>> = []
    const tilesetLoader = vi.spyOn(Cesium.Cesium3DTileset, 'fromUrl').mockImplementation(async (url, options) => {
      loadedTilesetOptions.push(options as Record<string, unknown>)
      return tilesets[url as keyof typeof tilesets] as never
    })
    const models: Array<{ modelMatrix: Cesium.Matrix4; show: boolean; id?: unknown }> = []
    const modelLoader = vi.spyOn(Cesium.Model, 'fromGltfAsync').mockImplementation(async options => {
      const model = { modelMatrix: Cesium.Matrix4.clone(options.modelMatrix!), show: options.show!, id: options.id }
      models.push(model)
      return model as never
    })
    const geoEntity = { properties: { name: { getValue: () => 'Downtown' } }, polygon: { material: undefined }, polyline: undefined, point: undefined }
    const dataSource = { show: true, entities: { values: [geoEntity] } }
    const geoJsonLoader = vi.spyOn(Cesium.GeoJsonDataSource, 'load').mockResolvedValue(dataSource as never)
    const callerEntity = {}, callerPrimitive = {}, callerLayer = {}, callerDataSource = {}
    const addedEntities: unknown[] = [], removedEntities: unknown[] = []
    const addedPrimitives: unknown[] = [], removedPrimitives: unknown[] = []
    const addedLayers: Array<{ show?: boolean; alpha?: number }> = [], addedProviders: Cesium.ImageryProvider[] = [], removedLayers: unknown[] = []
    const addedDataSources: unknown[] = [], removedDataSources: unknown[] = []
    let picked: unknown
    const viewer = {
      camera: { setView: vi.fn() },
      canvas: {}, selectedEntity: new Cesium.Entity({ id: 'caller-selection' }),
      scene: { fog: { density: 0, enabled: false }, postProcessStages: { bloom: { enabled: false } }, globe: { enableLighting: false }, pick: () => picked, primitives: { add: (value: unknown) => (addedPrimitives.push(value), value), remove: (value: unknown) => removedPrimitives.push(value) } },
      entities: { add: (value: unknown) => (addedEntities.push(value), value), remove: (value: unknown) => removedEntities.push(value) },
      imageryLayers: { addImageryProvider: (provider: Cesium.ImageryProvider) => { addedProviders.push(provider); const layer = { show: true, alpha: 1, destroy: vi.fn() }; addedLayers.push(layer); return layer }, remove: (layer: unknown, destroy: boolean) => { removedLayers.push([layer, destroy]); return true } },
      dataSources: { add: (value: unknown) => (addedDataSources.push(value), value), remove: (value: unknown, destroy: boolean) => removedDataSources.push([value, destroy]) },
      clock: { currentTime: Cesium.JulianDate.now() }, shadows: false
    }
    let clickAction: ((event: { position: unknown }) => void) | undefined
    let handlerDestroyed = false
    class FakeScreenSpaceEventHandler {
      constructor(_canvas: unknown) {}
      setInputAction(action: (event: { position: unknown }) => void) { clickAction = action }
      isDestroyed() { return handlerDestroyed }
      destroy() { handlerDestroyed = true }
    }
    const cesiumApi = Object.assign(Object.create(Cesium), { ScreenSpaceEventHandler: FakeScreenSpaceEventHandler, ScreenSpaceEventType: { LEFT_CLICK: 0 } })
    expect(inspectCesiumCodegenCapabilities(document).some(item => item.code === 'resource.hook' && item.severity === 'warning')).toBe(true)
    const generated = generateCesiumModule(document)
    expect(generated).not.toContain('PRIVATE_API_KEY_NAME')
    const api = loadGenerated(generated, cesiumApi)
    const result = await api.createScene(viewer, {
      credentials: { 'tiles-delta': 'runtime-secret-value' },
      resolveResource: (resource: { url?: string; reference?: { kind: string; path?: string } }, credentials: Record<string, string>) => {
        if (resource.reference) expect(resource.reference).toEqual({ kind: 'relative', path: 'assets/delta/tileset.json' })
        expect(credentials['tiles-delta']).toBe('runtime-secret-value')
        return resource.reference ? 'https://example.test/delta/tileset.json' : resource.url!
      }
    })
    expect(viewer.scene.fog).toEqual({ density: 0.00034, enabled: true })
    expect(viewer.scene.postProcessStages.bloom.enabled).toBe(true)
    expect(viewer.scene.globe.enableLighting).toBe(true)
    expect(viewer.shadows).toBe(true)
    expect(Cesium.JulianDate.equals(viewer.clock.currentTime, Cesium.JulianDate.fromIso8601('2026-10-23T04:00:00Z'))).toBe(true)
    expect(tilesetLoader).toHaveBeenCalledTimes(2)
    expect(loadedTilesetOptions[0].cacheBytes).toBe(256 * 1024 * 1024)
    expect(loadedTilesetOptions[1].cacheBytes).toBe(123_000_000)
    expect(Cesium.Matrix4.equals(tilesets['https://example.test/identity/tileset.json'].modelMatrix, Cesium.Matrix4.fromTranslation(new Cesium.Cartesian3(5, 6, 7)))).toBe(true)
    expect(Cesium.Matrix4.equalsEpsilon(tilesets['https://example.test/delta/tileset.json'].modelMatrix, enuExpected(deltaBase, tileOrigin, document.nodes[6].transform), 1e-10)).toBe(true)
    expect(tilesets['https://example.test/delta/tileset.json'].style.color.expression).toBe("color('red')")
    expect(models).toHaveLength(2)
    expect(models[1].id).toMatchObject({ sceneNodeId: 'model-delta', name: 'Model delta' })
    expect(Cesium.Matrix4.equalsEpsilon(models[0].modelMatrix, Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(116, 39, 20)), 1e-10)).toBe(true)
    expect(Cesium.Matrix4.equalsEpsilon(models[1].modelMatrix, enuExpected(Cesium.Transforms.eastNorthUpToFixedFrame(Cesium.Cartesian3.fromDegrees(116.1, 39.1, 30)), Cesium.Cartesian3.fromDegrees(116.1, 39.1, 30), document.nodes[8].transform), 1e-10)).toBe(true)
    expect(geoJsonLoader).toHaveBeenCalledWith('https://example.test/places.json', expect.objectContaining({ fill: expect.any(Cesium.Color), markerColor: expect.any(Cesium.Color) }))
    expect(dataSource.show).toBe(true)
    expect(geoEntity.description).toContain('Downtown')
    expect(geoEntity.polygon.material).toBeInstanceOf(Cesium.Color)
    expect(addedLayers[0]).toMatchObject({ show: true, alpha: 0.7 })
    expect(addedProviders[0].credit?.html).toContain('Example')
    expect(addedEntities[0]).toMatchObject({ name: 'Pin', point: { pixelSize: 8 }, description: expect.stringContaining('A&amp;B') })
    expect(addedEntities[1]).toMatchObject({ name: 'Line', polyline: { width: 5, clampToGround: true } })
    expect(clickAction).toBeTypeOf('function')
    picked = { primitive: tilesets['https://example.test/delta/tileset.json'], getPropertyIds: () => ['name', 'height'], getProperty: (key: string) => ({ name: 'Building 9', height: 42 } as Record<string, unknown>)[key] }
    clickAction!({ position: {} })
    const tilesetDescription = viewer.selectedEntity.description?.getValue(Cesium.JulianDate.now())
    expect(tilesetDescription).toContain('Building 9')
    expect(tilesetDescription).toContain('42')
    picked = { primitive: models[1], id: models[1].id }
    clickAction!({ position: {} })
    const modelDescription = viewer.selectedEntity.description?.getValue(Cesium.JulianDate.now())
    expect(modelDescription).toContain('GLB model')
    expect(modelDescription).toContain('Model delta')
    picked = undefined
    clickAction!({ position: {} })
    expect(viewer.selectedEntity.id).toBe('caller-selection')
    expect(result.dataSources).toEqual([dataSource])
    result.destroy()
    expect(handlerDestroyed).toBe(true)
    expect(removedEntities).toEqual(addedEntities)
    expect(removedPrimitives).toEqual(addedPrimitives)
    expect(removedLayers).toEqual([[addedLayers[0], true]])
    expect(removedDataSources).toEqual([[dataSource, true]])
    const removed = [...removedEntities, ...removedPrimitives, ...removedLayers.flat(), ...removedDataSources.flat()]
    expect(removed).not.toContain(callerEntity)
    expect(removed).not.toContain(callerPrimitive)
    expect(removed).not.toContain(callerLayer)
    expect(removed).not.toContain(callerDataSource)
    tilesetLoader.mockRestore(); modelLoader.mockRestore(); geoJsonLoader.mockRestore()
  })

  it('cleans already mounted objects when a later resource fails in createScene', async () => {
    const document = {
      ...cesiumDocument,
      resources: { first: { type: '3dtiles', url: 'https://example.test/first.json' }, second: { type: '3dtiles', url: 'https://example.test/second.json' } },
      nodes: [
        { id: 'first', name: 'First', type: '3dtiles', visible: true, resource: 'first', transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } },
        { id: 'second', name: 'Second', type: '3dtiles', visible: true, resource: 'second', transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } }
      ]
    }
    let firstDestroyed = false
    const firstTileset = {
      modelMatrix: Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY), boundingSphere: { center: Cesium.Cartesian3.fromDegrees(116, 39) }, show: true,
      isDestroyed: () => firstDestroyed, destroy: vi.fn(() => { firstDestroyed = true })
    }
    const loader = vi.spyOn(Cesium.Cesium3DTileset, 'fromUrl').mockImplementation(async url => {
      if (url === 'https://example.test/first.json') return firstTileset as never
      throw new Error('second resource failed')
    })
    const callerPrimitive = {}
    const collection = [callerPrimitive]
    const removed: unknown[] = []
    const viewer = {
      camera: { setView: vi.fn() }, selectedEntity: undefined, isDestroyed: () => false,
      scene: { primitives: { add: (value: unknown) => (collection.push(value), value), remove: (value: unknown) => { removed.push(value); const index = collection.indexOf(value); if (index < 0) return false; collection.splice(index, 1); (value as typeof firstTileset).destroy(); return true } } },
      entities: { remove: vi.fn() }, dataSources: { remove: vi.fn() }, imageryLayers: { remove: vi.fn() }
    }
    const api = loadGenerated(generateCesiumModule(document))
    await expect(api.createScene(viewer)).rejects.toThrow('second resource failed')
    expect(collection).toEqual([callerPrimitive])
    expect(removed).toEqual([firstTileset])
    expect(firstTileset.destroy).toHaveBeenCalledOnce()
    loader.mockRestore()
  })

  it('cleans a loaded GeoJSON data source when adding it to the caller viewer fails', async () => {
    const document = {
      ...cesiumDocument,
      resources: { places: { type: 'geojson', url: 'https://example.test/places.json' } },
      nodes: [{ id: 'places', name: 'Places', type: 'geojson', visible: true, resource: 'places' }]
    }
    let destroyed = false
    const source = { show: true, entities: { values: [] }, isDestroyed: () => destroyed, destroy: vi.fn(() => { destroyed = true }) }
    const loader = vi.spyOn(Cesium.GeoJsonDataSource, 'load').mockResolvedValue(source as never)
    const viewer = {
      camera: { setView: vi.fn() }, selectedEntity: undefined, isDestroyed: () => false,
      scene: { primitives: { add: vi.fn(), remove: vi.fn() } }, entities: { remove: vi.fn() },
      dataSources: { add: vi.fn(() => { throw new Error('data source add failed') }), remove: vi.fn(() => false) },
      imageryLayers: { remove: vi.fn() }
    }
    const api = loadGenerated(generateCesiumModule(document))
    await expect(api.createScene(viewer)).rejects.toThrow('data source add failed')
    expect(source.destroy).toHaveBeenCalledOnce()
    expect(destroyed).toBe(true)
    loader.mockRestore()
  })

  it('destroys an allocated but unadded tileset when ENU transform setup fails', async () => {
    const document = {
      ...cesiumDocument,
      resources: { city: { type: '3dtiles', url: 'https://example.test/city.json' } },
      nodes: [{ id: 'city', name: 'City', type: '3dtiles', visible: true, resource: 'city', transform: { translation: [1, 0, 0], rotation: [0, 0, 0], scale: 1 } }]
    }
    let destroyed = false
    const unaddedTileset = {
      modelMatrix: Cesium.Matrix4.clone(Cesium.Matrix4.IDENTITY), boundingSphere: { center: Cesium.Cartesian3.fromDegrees(116, 39) }, show: true,
      isDestroyed: () => destroyed, destroy: vi.fn(() => { destroyed = true })
    }
    const loader = vi.spyOn(Cesium.Cesium3DTileset, 'fromUrl').mockResolvedValue(unaddedTileset as never)
    const transform = vi.spyOn(Cesium.Transforms, 'eastNorthUpToFixedFrame').mockImplementation(() => { throw new Error('ENU setup failed') })
    const added: unknown[] = []
    const viewer = {
      camera: { setView: vi.fn() }, selectedEntity: undefined, isDestroyed: () => false,
      scene: { primitives: { add: (value: unknown) => (added.push(value), value), remove: vi.fn() } },
      entities: { remove: vi.fn() }, dataSources: { remove: vi.fn() }, imageryLayers: { remove: vi.fn() }
    }
    const api = loadGenerated(generateCesiumModule(document))
    await expect(api.createScene(viewer)).rejects.toThrow('ENU setup failed')
    expect(added).toEqual([])
    expect(unaddedTileset.destroy).toHaveBeenCalledOnce()
    expect(destroyed).toBe(true)
    transform.mockRestore(); loader.mockRestore()
  })

  it('honors nested hidden groups, reports omitted 2D content and pins target Cesium version', () => {
    const scene = { ...cesiumDocument, nodes: [
      { id: 'g', type: 'group', name: 'Hidden group', visible: false },
      { id: 'g2', type: 'group', name: 'Child', visible: true, parentId: 'g' },
      { id: 'tile2d', type: 'tile', name: '2D tile', visible: true, resource: 'map' }
    ], resources: { map: { type: 'xyz', url: 'https://example.test/{z}/{x}/{y}.png' } } }
    const diagnostics = inspectCesiumCodegenCapabilities(scene)
    expect(diagnostics.some(item => item.code === 'node.2d-omitted' && item.severity === 'warning')).toBe(true)
    expect(generateCesiumModule(scene)).not.toContain('https://example.test')
    expect(() => generateCesiumModule(cesiumDocument, { cesiumVersion: '1.146.0' })).toThrow('仅验证 Cesium 1.145.0')
  })
})

function enuExpected(base: Cesium.Matrix4, pivot: Cesium.Cartesian3, transform: { translation: [number, number, number]; rotation: [number, number, number]; scale: number }): Cesium.Matrix4 {
  const frame = Cesium.Transforms.eastNorthUpToFixedFrame(pivot)
  const rotation = Cesium.Quaternion.fromHeadingPitchRoll(new Cesium.HeadingPitchRoll(...transform.rotation.map(Cesium.Math.toRadians)))
  const delta = Cesium.Matrix4.fromTranslationQuaternionRotationScale(Cesium.Cartesian3.fromArray(transform.translation), rotation, new Cesium.Cartesian3(transform.scale, transform.scale, transform.scale))
  const result = Cesium.Matrix4.multiply(frame, delta, new Cesium.Matrix4())
  Cesium.Matrix4.multiply(result, Cesium.Matrix4.inverseTransformation(frame, new Cesium.Matrix4()), result)
  return Cesium.Matrix4.multiply(result, base, result)
}
