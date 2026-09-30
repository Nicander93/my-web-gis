import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type MapState } from '@desktop-webgis/gis-core'
import { mapCommands } from '@/app/commands/map.commands'
import { layerCommands } from '@/app/commands/layer.commands'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import {
  _setMapRuntimeForTests,
  getLiveMapState,
  isMapRuntimeMounted,
  syncMapFromProject,
  zoomMapBy,
  zoomMapToAll,
  zoomMapToLayer,
  retryMapServiceLayer
} from '@/features/map/map-runtime-host'
import type { OlMapRuntime } from '@desktop-webgis/ol-runtime'

const mapFeatureDir = join(dirname(fileURLToPath(import.meta.url)), '../features/map')

function resetStores(): void {
  ;(globalThis as unknown as { window: EventTarget }).window = new EventTarget()
  useSessionStore.setState({
    sessions: {},
    wfsLoadGeneration: 0,
    wfsAbortByLayer: {},
    mapViewExtentWgs84: [73, 18, 135, 54]
  })
  useProjectStore.getState()._resetAttributeHistoryForTests?.()
  useProjectStore.getState()._resetProjectHistoryForTests?.()
  layerCommands._resetStyleHistoryForTests?.()
  useProjectStore.getState().loadSnapshot({
    project: createProject('MapCanvas wiring'),
    featuresByDataset: {}
  })
  _setMapRuntimeForTests(null)
}

function createMockRuntime(initialZoom = 2): OlMapRuntime {
  let zoom = initialZoom
  let center: [number, number] = [0, 0]
  let rotation = 0
  const layers = new Map<string, unknown>()

  const view = {
    getZoom: () => zoom,
    setZoom: (value: number) => {
      zoom = value
    },
    animate: (options: { zoom?: number }) => {
      if (typeof options.zoom === 'number') zoom = options.zoom
    },
    getCenter: () => center,
    setCenter: (value: [number, number]) => {
      center = value
    },
    getRotation: () => rotation,
    setRotation: (value: number) => {
      rotation = value
    },
    getProjection: () => ({ getCode: () => 'EPSG:3857' }),
    calculateExtent: () => [-1, -1, 1, 1],
    fit: vi.fn()
  }

  const map = {
    getView: () => view,
    getSize: () => [800, 600] as [number, number],
    on: vi.fn(),
    un: vi.fn(),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    getLayers: () => ({ insertAt: vi.fn() })
  }

  return {
    registry: {
      clear: vi.fn(),
      entries: () => layers.entries(),
      get: (id: string) => layers.get(id),
      getVector: () => undefined,
      unregister: (id: string) => layers.delete(id),
      register: (id: string, _datasetId: string, layer: unknown) => layers.set(id, layer)
    },
    mount: vi.fn(),
    unmount: vi.fn(),
    getMap: () => map as never,
    onPointerMove: vi.fn(),
    syncBasemap: vi.fn(async () => undefined),
    getMapState: (): MapState => ({ center, zoom, rotation }),
    syncLayers: vi.fn(),
    retryWmsLayer: vi.fn(() => true),
    retryWmtsLayer: vi.fn(() => false),
    zoomToLayer: vi.fn(),
    zoomToAll: vi.fn()
  } as unknown as OlMapRuntime
}

describe('MapCanvas ↔ OlMapRuntime wiring', () => {
  beforeEach(() => {
    resetStores()
  })

  it('MapCanvas source no longer ships the placeholder watermark', () => {
    const src = readFileSync(join(mapFeatureDir, 'MapCanvas.tsx'), 'utf8')
    expect(src).not.toContain('地图运行时将在此接入')
    expect(src).not.toContain('map-watermark')
    expect(src).toContain('mountMapRuntime')
    expect(src).toContain('map-runtime-host')
    expect(src).toContain('map-canvas__viewport')
  })

  it('host reports mounted and syncs layers through OlMapRuntime.syncLayers', () => {
    const runtime = createMockRuntime(4)
    _setMapRuntimeForTests(runtime, true)
    expect(isMapRuntimeMounted()).toBe(true)

    useProjectStore.getState().addLayer(
      'ds-1',
      'Points',
      [
        {
          id: 'f1',
          geometry: { type: 'Point', coordinates: [120, 30] },
          properties: { name: 'a' }
        }
      ],
      'point'
    )

    syncMapFromProject()

    expect(runtime.syncLayers).toHaveBeenCalled()
    const [layers, featuresByDataset, datasets] = (runtime.syncLayers as ReturnType<typeof vi.fn>).mock
      .calls.at(-1)!
    expect(layers).toHaveLength(1)
    expect(Object.keys(featuresByDataset)).toContain('ds-1')
    expect(datasets).toHaveLength(1)
    // syncMapFromProject applies project.mapState (default zoom 2) on first project id sync
    expect(getLiveMapState()?.zoom).toBe(useProjectStore.getState().project.mapState.zoom)
  })

  it('zoom commands drive the real map view when runtime is mounted', () => {
    const runtime = createMockRuntime(5)
    _setMapRuntimeForTests(runtime, true)

    const messages: string[] = []
    const listener = (event: Event) => messages.push((event as CustomEvent<string>).detail)
    window.addEventListener('desktop-webgis:command-status', listener)

    expect(zoomMapBy(1)).toBe(true)
    expect(runtime.getMapState().zoom).toBe(6)

    mapCommands.zoomIn()
    expect(runtime.getMapState().zoom).toBe(7)
    expect(messages.at(-1)).toBe('放大地图')

    mapCommands.zoomOut()
    expect(runtime.getMapState().zoom).toBe(6)

    expect(zoomMapToAll()).toBe(true)
    expect(runtime.zoomToAll).toHaveBeenCalled()
    mapCommands.zoomToAll()
    expect(messages.at(-1)).toBe('缩放至全图')

    window.removeEventListener('desktop-webgis:command-status', listener)
  })

  it('layer zoom/retry call into the mounted runtime (not status-only placeholders)', () => {
    const runtime = createMockRuntime()
    _setMapRuntimeForTests(runtime, true)

    useProjectStore.getState().addLayer(
      'ds-v',
      'Local',
      [
        {
          id: 'f1',
          geometry: { type: 'Point', coordinates: [1, 2] },
          properties: {}
        }
      ],
      'point'
    )
    const layerId = useProjectStore.getState().selectedLayerId!
    expect(zoomMapToLayer(layerId)).toBe(true)
    expect(runtime.zoomToLayer).toHaveBeenCalledWith(layerId)

    layerCommands.zoomToLayer(layerId)
    expect(runtime.zoomToLayer).toHaveBeenCalledTimes(2)

    useProjectStore.getState().addServiceLayer({
      name: 'WMS',
      kind: 'wms',
      source: {
        type: 'wms',
        url: 'https://example.com/wms',
        version: '1.3.0',
        layerNames: ['rivers'],
        styleNames: [],
        format: 'image/png',
        transparent: true,
        crs: 'EPSG:3857',
        bboxWgs84: [100, 20, 110, 30],
        authMode: 'none'
      }
    })
    const wmsId = useProjectStore.getState().selectedLayerId!
    layerCommands.retryServiceLayer(wmsId)
    expect(retryMapServiceLayer(wmsId)).toBe(true)
    expect(runtime.retryWmsLayer).toHaveBeenCalled()
  })

  it('zoom commands fail closed when runtime is not mounted', () => {
    _setMapRuntimeForTests(null)
    expect(isMapRuntimeMounted()).toBe(false)
    expect(zoomMapBy(1)).toBe(false)
    expect(zoomMapToAll()).toBe(false)

    const messages: string[] = []
    const listener = (event: Event) => messages.push((event as CustomEvent<string>).detail)
    window.addEventListener('desktop-webgis:command-status', listener)
    mapCommands.zoomIn()
    expect(messages.at(-1)).toContain('未挂载')
    window.removeEventListener('desktop-webgis:command-status', listener)
  })
})
