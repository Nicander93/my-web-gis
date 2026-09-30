import type { BasemapConfig, MapState } from '@desktop-webgis/gis-core'
import { OlMapRuntime } from '@desktop-webgis/ol-runtime'
import { transformExtent } from 'ol/proj'
import { getSessionCredential } from '@/services/credentials'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'

let runtime: OlMapRuntime | null = null
let mounted = false
let lastSyncedProjectId: string | null = null
let lastBasemapKey = ''
let moveEndKey: (() => void) | null = null

export function getMapRuntime(): OlMapRuntime | null {
  return runtime
}

export function isMapRuntimeMounted(): boolean {
  return mounted && runtime !== null
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
  mounted = true
  lastSyncedProjectId = null
  lastBasemapKey = ''

  const map = runtime.getMap()
  const onMoveEnd = (): void => {
    syncSessionViewExtent()
  }
  map.on('moveend', onMoveEnd)
  moveEndKey = () => map.un('moveend', onMoveEnd)

  syncSessionViewExtent()
  return runtime
}

export function unmountMapRuntime(): void {
  moveEndKey?.()
  moveEndKey = null
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
  syncSessionViewExtent()
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

function collectBasemapCredentials(basemap: BasemapConfig): Record<string, string> {
  if (basemap.type !== 'tianditu' && basemap.type !== 'google-map-tiles') return {}
  const key = basemap.credential
  const stored = getSessionCredential(key)
  if (!stored) return {}
  return { [key]: stored.value }
}

/** Test helper: inject a prebuilt runtime (already mounted) or clear. */
export function _setMapRuntimeForTests(next: OlMapRuntime | null, isMounted = Boolean(next)): void {
  moveEndKey?.()
  moveEndKey = null
  runtime = next
  mounted = isMounted
  lastSyncedProjectId = null
  lastBasemapKey = ''
}
