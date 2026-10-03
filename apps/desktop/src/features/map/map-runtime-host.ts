import type { BasemapConfig, EditCommand, EditTool, MapState, SelectionState } from '@desktop-webgis/gis-core'
import { capabilitiesForDataset, isLegacyStyle } from '@desktop-webgis/gis-core'
import { OlMapRuntime, OlSelectionRuntime, OlToolRuntime, type ToolCallbacks } from '@desktop-webgis/ol-runtime'
import { transformExtent } from 'ol/proj'
import { getSessionCredential } from '@/services/credentials'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { useSnappingStore } from '@/stores/snapping.store'

let runtime: OlMapRuntime | null = null
let selectionRuntime: OlSelectionRuntime | null = null
let toolRuntime: OlToolRuntime | null = null
let mounted = false
let selectionMounted = false
let toolMounted = false
let activeTool: EditTool = 'none'
let lastSyncedProjectId: string | null = null
let lastBasemapKey = ''
let moveEndKey: (() => void) | null = null
let storeUnsub: (() => void) | null = null
let snappingUnsub: (() => void) | null = null
/** Avoid echoing map?store?map selection sync loops. */
let applyingStoreSelection = false

export function getMapRuntime(): OlMapRuntime | null {
  return runtime
}

export function getSelectionRuntime(): OlSelectionRuntime | null {
  return selectionRuntime
}

export function getToolRuntime(): OlToolRuntime | null {
  return toolRuntime
}

export function isMapRuntimeMounted(): boolean {
  return mounted && runtime !== null
}

export function isSelectionRuntimeMounted(): boolean {
  return selectionMounted && selectionRuntime !== null && isMapRuntimeMounted()
}

export function isToolRuntimeMounted(): boolean {
  return toolMounted && toolRuntime !== null && isMapRuntimeMounted()
}

export function getActiveEditTool(): EditTool {
  return activeTool
}

export function getLiveMapState(): MapState | null {
  if (!isMapRuntimeMounted() || !runtime) return null
  return runtime.getMapState()
}

export function mountMapRuntime(target: HTMLElement, mapState: MapState): OlMapRuntime {
  if (runtime && mounted) {
    unmountMapRuntime()
  }

  runtime = new OlMapRuntime()
  runtime.mount(target, mapState)
  selectionRuntime = new OlSelectionRuntime(runtime)
  toolRuntime = new OlToolRuntime(runtime)
  toolRuntime.setSnapping(useSnappingStore.getState().options, snapped => useSnappingStore.getState().setSnapped(snapped))
  snappingUnsub = useSnappingStore.subscribe((state, previous) => {
    if (state.options !== previous.options) toolRuntime?.setSnapping(state.options)
  })
  mounted = true
  selectionMounted = true
  toolMounted = true
  lastSyncedProjectId = null
  lastBasemapKey = ''
  activeTool = 'none'

  const map = runtime.getMap()
  const onMoveEnd = (): void => {
    syncSessionViewExtent()
    toolRuntime?.refreshSnapping()
  }
  map.on('moveend', onMoveEnd)
  moveEndKey = () => map.un('moveend', onMoveEnd)

  storeUnsub?.()
  storeUnsub = useProjectStore.subscribe((state, previous) => {
    if (!isMapRuntimeMounted()) return

    if (state.selection !== previous.selection) {
      syncSelectionHighlight(state.selection)
    }

    if (
      state.selectedLayerId !== previous.selectedLayerId &&
      (activeTool === 'select' || isDrawTool(activeTool) || activeTool === 'modify' || activeTool === 'delete')
    ) {
      // Re-bind tools/selection to the newly selected layer.
      setActiveEditTool(activeTool)
    }
  })

  syncSessionViewExtent()
  // Default interaction mode: select (scenario E path).
  setActiveEditTool('select')
  return runtime
}

export function unmountMapRuntime(): void {
  snappingUnsub?.()
  snappingUnsub = null
  storeUnsub?.()
  storeUnsub = null
  moveEndKey?.()
  moveEndKey = null
  selectionRuntime?.deactivate()
  toolRuntime?.deactivate()
  selectionRuntime = null
  toolRuntime = null
  selectionMounted = false
  toolMounted = false
  activeTool = 'none'
  runtime?.unmount()
  runtime = null
  mounted = false
  lastSyncedProjectId = null
  lastBasemapKey = ''
}

/** Pull layers / view / basemap from the project store into the mounted runtime. */
export function syncMapFromProject(): void {
  if (!runtime || !mounted) return

  const state = useProjectStore.getState()
  const { project, featuresByDataset } = state

  if (project.id !== lastSyncedProjectId) {
    lastSyncedProjectId = project.id
    const view = runtime.getMap().getView()
    view.setCenter(project.mapState.center)
    view.setZoom(project.mapState.zoom)
    view.setRotation(project.mapState.rotation)
    lastBasemapKey = ''
  }

  const basemapKey = JSON.stringify(project.basemap)
  if (basemapKey !== lastBasemapKey) {
    lastBasemapKey = basemapKey
    void runtime.syncBasemap(project.basemap, collectBasemapCredentials(project.basemap))
  }

  runtime.syncLayers(state.getMapLayers(), featuresByDataset, project.datasets)
  toolRuntime?.refreshSnapping()
  syncSessionViewExtent()
  syncSelectionHighlight(state.selection)
}

export function zoomMapBy(delta: number): boolean {
  if (!runtime || !mounted) return false
  const view = runtime.getMap().getView()
  const zoom = view.getZoom()
  if (zoom == null) return false
  view.animate({ zoom: zoom + delta, duration: 150 })
  return true
}

export function zoomMapToAll(): boolean {
  if (!runtime || !mounted) return false
  runtime.zoomToAll()
  return true
}

export function zoomMapToLayer(layerId: string): boolean {
  if (!runtime || !mounted) return false
  runtime.zoomToLayer(layerId)
  return true
}

export function retryMapServiceLayer(layerId: string): boolean {
  if (!runtime || !mounted) return false
  return runtime.retryWmsLayer(layerId) || runtime.retryWmtsLayer(layerId)
}

export function syncSessionViewExtent(): void {
  if (!runtime || !mounted) return
  const map = runtime.getMap()
  const size = map.getSize()
  if (!size || size[0] === 0 || size[1] === 0) return
  const view = map.getView()
  const extent = view.calculateExtent(size)
  const wgs84 = transformExtent(extent, view.getProjection(), 'EPSG:4326')
  if (wgs84.some((value) => !Number.isFinite(value))) return
  useSessionStore.getState().setMapViewExtentWgs84([
    wgs84[0],
    wgs84[1],
    wgs84[2],
    wgs84[3]
  ])
}

/**
 * Activate an edit/view tool. Select uses OlSelectionRuntime; draw/modify/delete use OlToolRuntime.
 * Returns false when map/selection/tool runtimes are not mounted (or tool cannot run).
 */
export function setActiveEditTool(tool: EditTool): boolean {
  if (!isMapRuntimeMounted() || !selectionRuntime || !toolRuntime) return false

  activeTool = tool

  if (tool === 'none' || tool === 'pan') {
    selectionRuntime.deactivate()
    toolRuntime.deactivate()
    return true
  }

  if (tool === 'select') {
    toolRuntime.deactivate()
    const layerId = useProjectStore.getState().selectedLayerId
    selectionRuntime.activate(layerId, (state) => {
      applyingStoreSelection = true
      try {
        useProjectStore.getState().setSelection(state)
      } finally {
        applyingStoreSelection = false
      }
    })
    syncSelectionHighlight(useProjectStore.getState().selection)
    return true
  }

  // Draw / modify / delete require a vector layer that supports geometry edits.
  selectionRuntime.deactivate()
  const layerId = useProjectStore.getState().selectedLayerId
  if (!layerId) {
    toolRuntime.deactivate()
    return false
  }
  const project = useProjectStore.getState().project
  const layer = project.layers.find((item) => item.id === layerId)
  const dataset = layer ? project.datasets.find((item) => item.id === layer.datasetId) : undefined
  if (!capabilitiesForDataset(dataset).editGeometry) {
    toolRuntime.deactivate()
    return false
  }

  const resolved: EditTool = isDrawTool(tool) ? resolveDrawTool(layerId) : tool
  activeTool = resolved
  toolRuntime.activate(resolved, createToolCallbacks())
  return true
}

export function clearMapSelection(): boolean {
  if (!isMapRuntimeMounted()) {
    useProjectStore.getState().clearSelection()
    return false
  }
  selectionRuntime?.clear()
  useProjectStore.getState().clearSelection()
  return true
}

function createToolCallbacks(): ToolCallbacks {
  return {
    getActiveLayerId: () => useProjectStore.getState().selectedLayerId,
    onAddFeature: (_datasetId, _feature, command) => {
      useProjectStore.getState().executeEditCommand(command)
      syncMapFromProject()
    },
    onDeleteFeatures: (_datasetId, _features, commands) => {
      useProjectStore.getState().executeEditCommands(commands)
      useProjectStore.getState().clearSelection()
      syncMapFromProject()
    },
    onUpdateGeometry: (_datasetId, _featureId, _before, _after, command) => {
      useProjectStore.getState().executeEditCommand(command)
      syncMapFromProject()
    },
    onSelectionChange: (featureIds) => {
      const layerId = useProjectStore.getState().selectedLayerId
      if (!layerId) return
      applyingStoreSelection = true
      try {
        useProjectStore.getState().setSelection({ layerId, featureIds })
      } finally {
        applyingStoreSelection = false
      }
    }
  }
}

function syncSelectionHighlight(selection: SelectionState): void {
  if (!selectionRuntime || applyingStoreSelection) return
  if (activeTool !== 'select') return
  selectionRuntime.syncSelection(selection)
}

function isDrawTool(tool: EditTool): boolean {
  return tool === 'draw-point' || tool === 'draw-line' || tool === 'draw-polygon'
}

/** Pick draw geometry from layer style kind / symbol, falling back to existing feature geometry. */
function resolveDrawTool(layerId: string): EditTool {
  const state = useProjectStore.getState()
  const layer = state.project.layers.find((item) => item.id === layerId)
  if (!layer) return 'draw-point'

  if (isLegacyStyle(layer.style)) {
    if (layer.style.kind === 'line') return 'draw-line'
    if (layer.style.kind === 'polygon') return 'draw-polygon'
    if (layer.style.kind === 'point') return 'draw-point'
  } else {
    const symbol =
      layer.style.mode === 'single'
        ? layer.style.symbol
        : 'fallback' in layer.style
          ? layer.style.fallback
          : null
    if (symbol?.type === 'circle') return 'draw-point'
    if (symbol?.type === 'solid' && 'color' in symbol && !('fill' in symbol)) return 'draw-line'
    if (symbol?.type === 'solid' && 'fill' in symbol) return 'draw-polygon'
  }

  const features = state.getLayerFeatures(layerId)
  const geom = features[0]?.geometry?.type
  if (geom === 'LineString' || geom === 'MultiLineString') return 'draw-line'
  if (geom === 'Polygon' || geom === 'MultiPolygon') return 'draw-polygon'
  return 'draw-point'
}

function collectBasemapCredentials(basemap: BasemapConfig): Record<string, string> {
  if (basemap.type !== 'tianditu' && basemap.type !== 'google-map-tiles') return {}
  const key = basemap.credential
  const stored = getSessionCredential(key)
  if (!stored) return {}
  return { [key]: stored.value }
}

/** Test helper: inject a prebuilt runtime (already mounted) or clear. */
export function _setMapRuntimeForTests(
  next: OlMapRuntime | null,
  isMounted = Boolean(next),
  options?: { selection?: boolean; tool?: boolean; activeTool?: EditTool }
): void {
  snappingUnsub?.()
  snappingUnsub = null
  storeUnsub?.()
  storeUnsub = null
  moveEndKey?.()
  moveEndKey = null
  selectionRuntime?.deactivate()
  toolRuntime?.deactivate()
  selectionRuntime = null
  toolRuntime = null
  runtime = next
  mounted = isMounted
  selectionMounted = Boolean(options?.selection ?? (isMounted && next))
  toolMounted = Boolean(options?.tool ?? (isMounted && next))
  activeTool = options?.activeTool ?? (isMounted ? 'select' : 'none')
  lastSyncedProjectId = null
  lastBasemapKey = ''

  if (next && isMounted) {
    // Lightweight stand-ins so getSelectionRuntime/getToolRuntime are non-null in unit tests.
    selectionRuntime = {
      activate: () => undefined,
      deactivate: () => undefined,
      syncSelection: () => undefined,
      clear: () => undefined
    } as unknown as OlSelectionRuntime
    toolRuntime = {
      activate: () => undefined,
      refreshSnapping: () => undefined,
      deactivate: () => undefined
    } as unknown as OlToolRuntime
  }
}
