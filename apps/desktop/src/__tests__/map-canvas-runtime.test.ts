import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject, type MapState } from '@desktop-webgis/gis-core'
import { mapCommands } from '@/app/commands/map.commands'
import { editCommands } from '@/app/commands/edit.commands'
import { layerCommands } from '@/app/commands/layer.commands'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import {
  _setMapRuntimeForTests,
  getActiveEditTool,
  getLiveMapState,
  isMapRuntimeMounted,
  isSelectionRuntimeMounted,
  isToolRuntimeMounted,
  setActiveEditTool,
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
    addInteraction: vi.fn(),
    removeInteraction: vi.fn(),
    getLayers: () => ({ insertAt: vi.fn() })
  }

  return {
    registry: {
      clear: vi.fn(),
      entries: () => layers.entries(),
      get: (id: string) => layers.get(id),
      getVector: () => undefined,
      getDatasetIdForLayer: () => undefined,
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

describe('MapCanvas OlMapRuntime selection tool wiring', () => {
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
    expect(src).toContain('data-selection-runtime')
    expect(src).toContain('data-tool-runtime')
  })

  it('host source mounts OlSelectionRuntime and OlToolRuntime with the map', () => {
    const src = readFileSync(join(mapFeatureDir, 'map-runtime-host.ts'), 'utf8')
    expect(src).toContain('OlSelectionRuntime')
    expect(src).toContain('OlToolRuntime')
    expect(src).toContain('new OlSelectionRuntime')
    expect(src).toContain('new OlToolRuntime')
    expect(src).toContain('isSelectionRuntimeMounted')
    expect(src).toContain('isToolRuntimeMounted')
    expect(src).toContain('setActiveEditTool')
  })

  it('host reports map/selection/tool mounted together', () => {
    const runtime = createMockRuntime(4)
    _setMapRuntimeForTests(runtime, true)
    expect(isMapRuntimeMounted()).toBe(true)
    expect(isSelectionRuntimeMounted()).toBe(true)
    expect(isToolRuntimeMounted()).toBe(true)
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
    expect(isSelectionRuntimeMounted()).toBe(false)
    expect(isToolRuntimeMounted()).toBe(false)
    expect(zoomMapBy(1)).toBe(false)
    expect(zoomMapToAll()).toBe(false)

    const messages: string[] = []
    const listener = (event: Event) => messages.push((event as CustomEvent<string>).detail)
    window.addEventListener('desktop-webgis:command-status', listener)
    mapCommands.zoomIn()
    expect(messages.at(-1)).toContain('未挂载')
    window.removeEventListener('desktop-webgis:command-status', listener)
  })

  it('select / draw / modify / delete commands fail closed when runtimes are not mounted', () => {
    _setMapRuntimeForTests(null)
    const messages: string[] = []
    const listener = (event: Event) => messages.push((event as CustomEvent<string>).detail)
    window.addEventListener('desktop-webgis:command-status', listener)

    mapCommands.select()
    expect(messages.at(-1)).toContain('未挂载')
    expect(messages.at(-1)).not.toContain('待接入')

    editCommands.draw()
    expect(messages.at(-1)).toContain('未挂载')
    expect(messages.at(-1)).not.toContain('待接入')

    editCommands.modify()
    expect(messages.at(-1)).toContain('未挂载')

    editCommands.deleteSelected()
    expect(messages.at(-1)).toContain('未挂载')

    window.removeEventListener('desktop-webgis:command-status', listener)
  })

  it('select command activates selection tool when runtimes are mounted', () => {
    const runtime = createMockRuntime()
    _setMapRuntimeForTests(runtime, true)

    const messages: string[] = []
    const listener = (event: Event) => messages.push((event as CustomEvent<string>).detail)
    window.addEventListener('desktop-webgis:command-status', listener)

    mapCommands.select()
    expect(getActiveEditTool()).toBe('select')
    expect(messages.at(-1)).toBe('选择要素')
    expect(messages.at(-1)).not.toContain('待接入')

    window.removeEventListener('desktop-webgis:command-status', listener)
  })

  it('draw/modify activate OlToolRuntime path for editable vector layers', () => {
    const runtime = createMockRuntime()
    _setMapRuntimeForTests(runtime, true)

    useProjectStore.getState().addLayer(
      'ds-edit',
      'Editable points',
      [
        {
          id: 'f1',
          geometry: { type: 'Point', coordinates: [1, 2] },
          properties: {}
        }
      ],
      'point'
    )

    const messages: string[] = []
    const listener = (event: Event) => messages.push((event as CustomEvent<string>).detail)
    window.addEventListener('desktop-webgis:command-status', listener)

    editCommands.draw()
    expect(getActiveEditTool()).toBe('draw-point')
    expect(messages.at(-1)).toContain('绘制工具已激活')
    expect(messages.at(-1)).not.toContain('待接入')

    editCommands.modify()
    expect(getActiveEditTool()).toBe('modify')
    expect(messages.at(-1)).toContain('修改工具已激活')

    expect(setActiveEditTool('delete')).toBe(true)
    expect(getActiveEditTool()).toBe('delete')

    window.removeEventListener('desktop-webgis:command-status', listener)
  })

  it('edit commands refuse non-editable service layers', () => {
    const runtime = createMockRuntime()
    _setMapRuntimeForTests(runtime, true)

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
        authMode: 'none'
      }
    })

    const messages: string[] = []
    const listener = (event: Event) => messages.push((event as CustomEvent<string>).detail)
    window.addEventListener('desktop-webgis:command-status', listener)

    editCommands.draw()
    expect(messages.at(-1)).toContain('可编辑矢量图层')

    window.removeEventListener('desktop-webgis:command-status', listener)
  })
})
