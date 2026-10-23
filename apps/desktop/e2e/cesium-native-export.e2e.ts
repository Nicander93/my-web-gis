import { expect, test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { generateCesiumModule } from '@desktop-webgis/scene-codegen'

test('generated Cesium module mounts independently with native resources and cleans up', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const outputPath = testInfo.outputPath('native-scene.mjs')
  await mkdir(dirname(outputPath), { recursive: true })
  const document = {
    version: 3, id: 'native-export-e2e', title: 'Native Cesium export', activeView: 'main',
    resources: {
      city: { type: '3dtiles', reference: { kind: 'relative', path: 'city-sample/tileset.json' } },
      tower: { type: 'glb', reference: { kind: 'relative', path: 'city-sample/tower.glb' } }
    },
    views: { main: { type: '3d', heightReference: 'ellipsoid', camera: { position: [116.391, 39.907, 1200], heading: 0, pitch: -35, roll: 0 } } },
    environment: {
      effects: { fog: 0.17, bloom: true },
      lighting: { sunlight: true, shadows: true, time: '2026-10-23T04:00:00Z' }
    },
    nodes: [
      { type: '3dtiles', id: 'city-tiles', name: 'City sample', visible: true, resource: 'city', maximumScreenSpaceError: 5, transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }, style: { color: 'color("#d65b43")' } },
      { type: 'model', id: 'tower-model', name: 'Tower model', visible: true, resource: 'tower', position: [116.391, 39.907, 20], transform: { translation: [8, 3, 2], rotation: [0, 0, 0], scale: 1 } },
      { type: 'graphic', id: 'export-point', name: 'Export graphic', visible: true, geometry: { type: 'point', positions: [[116.392, 39.908, 10]], heightMode: 'absolute' }, style: { color: '#2080d0', width: 2, pointSize: 13 }, properties: { source: 'native-e2e' } }
    ]
  }
  const generatedModule = generateCesiumModule(document)
  await writeFile(outputPath, generatedModule, 'utf8')
  const projectName = testInfo.project.name.replace(/[^a-z\d-]/gi, '-')
  const servedModulePath = resolve('apps/desktop/.artifacts/cesium-native-export', `${projectName}-${process.pid}`, 'native-scene.mjs')
  await mkdir(dirname(servedModulePath), { recursive: true })
  await writeFile(servedModulePath, generatedModule, 'utf8')
  const moduleUrl = `/@fs/${servedModulePath.replaceAll('\\', '/')}`

  await page.route('**/*tile.openstreetmap.org/**', route => route.abort())
  await page.goto('/')
  await page.evaluate(async url => {
    ;(window as Window & { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = '/cesium/'
    const container = document.createElement('div')
    container.id = 'native-export-container'
    Object.assign(container.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '9999' })
    document.body.append(container)
    const generated = await import(url) as { mountScene(container: HTMLElement, options: unknown): Promise<unknown> }
    const mounted = await generated.mountScene(container, { hooks: { resolveResource: (resource: { reference?: { path?: string } }) => `/${resource.reference?.path}` }, viewerOptions: {
      baseLayer: false,
      animation: false, timeline: false, geocoder: false, homeButton: false,
      sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false,
      baseLayerPicker: false, selectionIndicator: false, infoBox: false,
      requestRenderMode: false
    } }) as Record<string, unknown>
    ;(window as Window & { __nativeExport?: Record<string, unknown> }).__nativeExport = mounted as Record<string, unknown>
  }, moduleUrl)

  await expect.poll(() => page.evaluate(() => {
    const state = (window as Window & { __nativeExport?: Record<string, unknown> }).__nativeExport
    const primitives = state?.primitives as Array<{ constructor: { name: string }; ready?: boolean; tilesLoaded?: boolean }>
    return Boolean(primitives?.some(item => item.constructor.name === 'Cesium3DTileset' && item.tilesLoaded)
      && primitives.some(item => item.constructor.name === 'Model' && item.ready))
  }), { timeout: 50_000, intervals: [250, 500, 1000] }).toBe(true)

  const inspection = await page.evaluate(() => {
    const state = (window as Window & { __nativeExport?: Record<string, unknown> }).__nativeExport!
    const viewer = state.viewer as import('cesium').Viewer
    const primitives = state.primitives as Array<import('cesium').Cesium3DTileset | import('cesium').Model>
    const tileset = primitives.find(item => item.constructor.name === 'Cesium3DTileset') as import('cesium').Cesium3DTileset
    const model = primitives.find(item => item.constructor.name === 'Model') as import('cesium').Model
    const graphic = (state.entities as import('cesium').Entity[])[0]
    const longitude = 116.391 * Math.PI / 180, latitude = 39.907 * Math.PI / 180
    const sinLatitude = Math.sin(latitude), cosLatitude = Math.cos(latitude), sinLongitude = Math.sin(longitude), cosLongitude = Math.cos(longitude)
    const semiMajor = 6378137, eccentricitySquared = 6.69437999014e-3
    const radius = semiMajor / Math.sqrt(1 - eccentricitySquared * sinLatitude * sinLatitude)
    const origin = [(radius + 20) * cosLatitude * cosLongitude, (radius + 20) * cosLatitude * sinLongitude, (radius * (1 - eccentricitySquared) + 20) * sinLatitude]
    const expectedPosition = [
      origin[0] + 8 * -sinLongitude + 3 * -sinLatitude * cosLongitude + 2 * cosLatitude * cosLongitude,
      origin[1] + 8 * cosLongitude + 3 * -sinLatitude * sinLongitude + 2 * cosLatitude * sinLongitude,
      origin[2] + 3 * cosLatitude + 2 * sinLatitude
    ]
    const actualPosition = [model.modelMatrix[12], model.modelMatrix[13], model.modelMatrix[14]]
    // Cesium stores JulianDate in TAI; include the current 37-second UTC offset.
    const expectedJulian = new Date('2026-10-23T04:00:00Z').getTime() / 86_400_000 + 2_440_587.5 + 37 / 86_400
    const actualJulian = viewer.clock.currentTime.dayNumber + viewer.clock.currentTime.secondsOfDay / 86_400
    return {
      webgl2: viewer.scene.context.webgl2,
      tilesetLoaded: tileset.tilesLoaded,
      tilesetStyle: tileset.style?.color?.expression,
      tilesetError: tileset.maximumScreenSpaceError,
      tilesetCacheBytes: tileset.cacheBytes,
      modelReady: model.ready,
      modelWorldPositionError: Math.hypot(...expectedPosition.map((value, index) => value - actualPosition[index])),
      graphicOwned: viewer.entities.contains(graphic),
      graphicColor: graphic.point?.color?.getValue(viewer.clock.currentTime)?.toCssColorString(),
      fogDensity: viewer.scene.fog.density,
      bloom: viewer.scene.postProcessStages.bloom.enabled,
      sunlight: viewer.scene.globe.enableLighting,
      shadows: viewer.shadows,
      currentTimeErrorDays: Math.abs(expectedJulian - actualJulian),
      primitiveCount: primitives.length,
      scenePrimitiveCount: viewer.scene.primitives.length,
      entityCount: viewer.entities.values.length
    }
  })
  expect(inspection.webgl2).toBe(true)
  expect(inspection.tilesetLoaded).toBe(true)
  expect(inspection.tilesetStyle).toContain('#d65b43')
  expect(inspection.tilesetError).toBe(5)
  expect(inspection.tilesetCacheBytes).toBe(256 * 1024 * 1024)
  expect(inspection.modelReady).toBe(true)
  expect(inspection.modelWorldPositionError).toBeLessThan(0.01)
  expect(inspection.graphicOwned).toBe(true)
  expect(inspection.graphicColor).toBe('rgb(32,128,208)')
  expect(inspection.fogDensity).toBeCloseTo(0.00034, 8)
  expect(inspection.bloom).toBe(true)
  expect(inspection.sunlight).toBe(true)
  expect(inspection.shadows).toBe(true)
  expect(inspection.currentTimeErrorDays).toBeLessThan(1e-8)
  expect(inspection.primitiveCount).toBe(2)
  expect(inspection.scenePrimitiveCount).toBe(3)
  expect(inspection.entityCount).toBe(1)

  await page.evaluate(() => {
    const state = (window as Window & { __nativeExport?: Record<string, unknown> }).__nativeExport!
    const ownedPrimitives = state.primitives as Array<{ isDestroyed(): boolean }>
    const viewer = state.viewer as import('cesium').Viewer
    const primitiveCollection = viewer.scene.primitives
    const entityCollection = viewer.entities
    let removedPrimitives = 0, removedEntities = 0
    const removePrimitive = primitiveCollection.remove.bind(primitiveCollection)
    const removeEntity = entityCollection.remove.bind(entityCollection)
    primitiveCollection.remove = (primitive: import('cesium').Primitive) => { removedPrimitives++; return removePrimitive(primitive) }
    entityCollection.remove = (entity: import('cesium').Entity) => { removedEntities++; return removeEntity(entity) }
    ;(state.destroy as () => void)()
    ;(window as Window & { __nativeExport?: Record<string, unknown> }).__nativeExport = {
      viewerDestroyed: viewer.isDestroyed(), ownedPrimitivesDestroyed: ownedPrimitives.every(item => item.isDestroyed()),
      removedPrimitives, removedEntities
    }
    document.querySelector('#native-export-container')?.remove()
  })
  expect(await page.evaluate(() => (window as Window & { __nativeExport?: Record<string, unknown> }).__nativeExport)).toEqual({
    viewerDestroyed: true, ownedPrimitivesDestroyed: true, removedPrimitives: 3, removedEntities: 1
  })
})
