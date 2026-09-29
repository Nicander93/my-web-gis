import { applyFieldFilter,
  isTileServiceKind,
  layerListZIndex, type BasemapConfig, type Dataset, type GisFeature, type Layer, type MapState, type WmsDataset, type WmtsDataset } from '@desktop-webgis/gis-core'
import { createOlSceneLayer, updateGoogleMapTilesAttribution } from '@desktop-webgis/ol-scene-runtime'
import type { SceneSource } from '@desktop-webgis/scene-schema'
import OlMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import type BaseLayer from 'ol/layer/Base'
import VectorLayer from 'ol/layer/Vector'
import OSM from 'ol/source/OSM'
import TileWMS from 'ol/source/TileWMS'
import VectorSource from 'ol/source/Vector'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import { defaults as defaultInteractions } from 'ol/interaction'
import { boundingExtent, isEmpty } from 'ol/extent'
import { transformExtent } from 'ol/proj'
import type { Coordinate } from 'ol/coordinate'
import { toOlFeature } from '../feature/featureAdapter'
import { OlLayerRegistry } from '../layer/OlLayerRegistry'
import { createLayerStyle } from '../layer/style'
import {
  createWmsTileLayer,
  GIS_WMS_EXTENT_KEY,
  refreshWmsTileLayer
} from '../wms/createWmsLayer'
import {
  createWmtsTileLayer,
  GIS_WMTS_EXTENT_KEY,
  refreshWmtsTileLayer
} from '../wmts/createWmtsLayer'
import type WMTS from 'ol/source/WMTS'

export interface PointerInfo {
  coordinate: Coordinate
  scaleText: string
}

export class OlMapRuntime {
  readonly registry = new OlLayerRegistry()
  private map: OlMap | null = null
  private basemapLayer: BaseLayer | null = null
  private basemapRevision = 0
  private fetcher: typeof globalThis.fetch | undefined = globalThis.fetch
  private pointerMove?: (info: PointerInfo) => void

  mount(target: HTMLElement, mapState: MapState): OlMap {
    this.map = new OlMap({
      target,
      layers: [],
      view: new View({
        center: mapState.center,
        zoom: mapState.zoom,
        rotation: mapState.rotation
      }),
      controls: defaultControls({ attribution: true, zoom: true }).extend([new ScaleLine()]),
      interactions: defaultInteractions()
    })

    this.basemapLayer = new TileLayer({ source: new OSM() })
    this.map.addLayer(this.basemapLayer)

    this.map.on('pointermove', (event) => {
      const view = this.map?.getView()
      if (!view || !this.pointerMove) return
      this.pointerMove({
        coordinate: event.coordinate,
        scaleText: estimateScale(view.getZoom() ?? 2)
      })
    })

    this.map.on('moveend', () => {
      if (!this.basemapLayer || !this.map) return
      void updateGoogleMapTilesAttribution(
        this.basemapLayer,
        this.map.getView(),
        this.map.getSize(),
        this.fetcher
      )
    })

    return this.map
  }

  unmount(): void {
    this.registry.clear()
    this.map?.setTarget(undefined)
    this.map = null
  }

  getMap(): OlMap {
    if (!this.map) throw new Error('Map runtime is not mounted.')
    return this.map
  }

  onPointerMove(callback: (info: PointerInfo) => void): void {
    this.pointerMove = callback
  }

  async syncBasemap(
    config: BasemapConfig,
    credentials: Record<string, string> = {},
    fetcher: typeof globalThis.fetch | undefined = globalThis.fetch
  ): Promise<void> {
    const map = this.getMap()
    const revision = ++this.basemapRevision
    this.fetcher = fetcher
    const source = toSceneSource(config)
    const layer = await createOlSceneLayer(
      { id: '__basemap', type: 'tile', name: 'Basemap', source: '__basemap', role: 'basemap' },
      { __basemap: source },
      map.getView(),
      { credentials, fetch: fetcher }
    )
    if (revision !== this.basemapRevision) return
    if (this.basemapLayer) map.removeLayer(this.basemapLayer)
    this.basemapLayer = layer
    map.getLayers().insertAt(0, layer)
    await updateGoogleMapTilesAttribution(layer, map.getView(), map.getSize(), fetcher)
  }

  getMapState(): MapState {
    const view = this.getMap().getView()
    return {
      center: view.getCenter() as [number, number],
      zoom: view.getZoom() ?? 2,
      rotation: view.getRotation()
    }
  }

  /**
   * Sync project layers to OpenLayers.
   * Vector datasets use VectorLayer; WMS uses TileWMS (P16); WMTS uses ol/source/WMTS (P17).
   */
  syncLayers(
    layers: Layer[],
    featuresByDataset: Record<string, GisFeature[]>,
    datasets: Dataset[] = []
  ): void {
    const map = this.getMap()
    const datasetById = new Map(datasets.map((dataset) => [dataset.id, dataset]))
    const liveLayerIds = new Set(layers.map((layer) => layer.id))

    for (const [layerId, runtimeLayer] of this.registry.entries()) {
      if (!liveLayerIds.has(layerId)) {
        map.removeLayer(runtimeLayer)
        this.registry.unregister(layerId)
      }
    }

    layers.forEach((layer, index) => {
      const dataset = datasetById.get(layer.datasetId)
      const zIndex = layerListZIndex(index, layers.length)

      if (dataset?.kind === 'wms') {
        this.syncWmsLayer(layer, dataset, zIndex)
        return
      }

      if (dataset?.kind === 'wmts') {
        this.syncWmtsLayer(layer, dataset, zIndex)
        return
      }

      // Other tile-service kinds: never register as VectorLayer.
      if (dataset && isTileServiceKind(dataset.kind)) {
        const mistaken = this.registry.get(layer.id)
        if (mistaken) {
          map.removeLayer(mistaken)
          this.registry.unregister(layer.id)
        }
        return
      }

      const allFeatures = featuresByDataset[layer.datasetId] ?? []
      const features = applyFieldFilter(allFeatures, layer.filter)
      const existing = this.registry.getVector(layer.id)
      if (existing) {
        existing.setVisible(layer.visible)
        existing.setOpacity(layer.opacity)
        existing.setStyle(createLayerStyle(layer))
        existing.setZIndex(zIndex)
        const source = existing.getSource()
        source?.clear()
        source?.addFeatures(features.map(toOlFeature))
        return
      }

      // Replace a prior non-vector registration if present.
      const prior = this.registry.get(layer.id)
      if (prior) {
        map.removeLayer(prior)
        this.registry.unregister(layer.id)
      }

      const source = new VectorSource({
        features: features.map(toOlFeature)
      })
      const vectorLayer = new VectorLayer({
        source,
        visible: layer.visible,
        opacity: layer.opacity,
        style: createLayerStyle(layer),
        zIndex
      })
      map.addLayer(vectorLayer)
      this.registry.register(layer.id, layer.datasetId, vectorLayer)
    })
  }

  private syncWmsLayer(layer: Layer, dataset: WmsDataset, zIndex: number): void {
    const map = this.getMap()
    const existing = this.registry.get(layer.id)
    if (existing) {
      const source = (existing as TileLayer<TileWMS>).getSource?.()
      const isWms = Boolean(source && typeof (source as TileWMS).updateParams === 'function')
      if (isWms) {
        existing.setVisible(layer.visible)
        existing.setOpacity(layer.opacity)
        existing.setZIndex(zIndex)
        if (dataset.source.bboxWgs84) {
          existing.set(GIS_WMS_EXTENT_KEY, dataset.source.bboxWgs84.slice())
        }
        return
      }
      map.removeLayer(existing)
      this.registry.unregister(layer.id)
    }

    const wmsLayer = createWmsTileLayer({
      layerId: layer.id,
      dataset,
      visible: layer.visible,
      opacity: layer.opacity,
      zIndex
    })
    map.addLayer(wmsLayer)
    this.registry.register(layer.id, layer.datasetId, wmsLayer)
  }

  private syncWmtsLayer(layer: Layer, dataset: WmtsDataset, zIndex: number): void {
    const map = this.getMap()
    const existing = this.registry.get(layer.id)
    if (existing) {
      const source = (existing as TileLayer<WMTS>).getSource?.()
      const isWmts = Boolean(source && typeof (source as WMTS).getRequestEncoding === 'function')
      if (isWmts) {
        existing.setVisible(layer.visible)
        existing.setOpacity(layer.opacity)
        existing.setZIndex(zIndex)
        if (dataset.source.bboxWgs84) {
          existing.set(GIS_WMTS_EXTENT_KEY, dataset.source.bboxWgs84.slice())
        }
        return
      }
      map.removeLayer(existing)
      this.registry.unregister(layer.id)
    }

    const wmtsLayer = createWmtsTileLayer({
      layerId: layer.id,
      dataset,
      visible: layer.visible,
      opacity: layer.opacity,
      zIndex
    })
    map.addLayer(wmtsLayer)
    this.registry.register(layer.id, layer.datasetId, wmtsLayer)
  }

  /** Re-request WMS tiles after a transient failure. */
  retryWmsLayer(layerId: string): boolean {
    const layer = this.registry.get(layerId) as TileLayer<TileWMS> | undefined
    if (!layer) return false
    const source = layer.getSource?.()
    if (!source || typeof source.updateParams !== 'function') return false
    refreshWmsTileLayer(layer)
    return true
  }

  /** Re-request WMTS tiles after a transient failure. */
  retryWmtsLayer(layerId: string): boolean {
    const layer = this.registry.get(layerId) as TileLayer<WMTS> | undefined
    if (!layer) return false
    const source = layer.getSource?.()
    if (!source || typeof (source as WMTS).getRequestEncoding !== 'function') return false
    refreshWmtsTileLayer(layer)
    return true
  }

  zoomToLayer(layerId: string): void {
    const layer = this.registry.get(layerId)
    if (!layer) return

    const vector = this.registry.getVector(layerId)
    if (vector) {
      const extent = vector.getSource()?.getExtent()
      if (!extent || isEmpty(extent)) return
      this.fitExtent(extent)
      return
    }

    const bboxWgs84 = (layer.get(GIS_WMS_EXTENT_KEY) ?? layer.get(GIS_WMTS_EXTENT_KEY)) as
      | [number, number, number, number]
      | undefined
    if (!bboxWgs84) return
    const viewProj = this.getMap().getView().getProjection()
    const extent = transformExtent(bboxWgs84, 'EPSG:4326', viewProj)
    if (isEmpty(extent)) return
    this.fitExtent(extent)
  }

  zoomToAll(): void {
    const extents: Array<[number, number, number, number]> = []
    for (const [layerId, layer] of this.registry.entries()) {
      const vector = this.registry.getVector(layerId)
      if (vector) {
        const extent = vector.getSource()?.getExtent()
        if (extent && !isEmpty(extent)) extents.push(extent as [number, number, number, number])
        continue
      }
      const bboxWgs84 = (layer.get(GIS_WMS_EXTENT_KEY) ?? layer.get(GIS_WMTS_EXTENT_KEY)) as
        | [number, number, number, number]
        | undefined
      if (!bboxWgs84) continue
      const viewProj = this.getMap().getView().getProjection()
      const extent = transformExtent(bboxWgs84, 'EPSG:4326', viewProj) as [
        number,
        number,
        number,
        number
      ]
      if (!isEmpty(extent)) extents.push(extent)
    }
    if (extents.length === 0) return
    const extent = boundingExtent(
      extents.flatMap((item) => [
        [item[0], item[1]],
        [item[2], item[3]]
      ])
    )
    this.fitExtent(extent)
  }

  private fitExtent(extent: number[]): void {
    this.getMap().getView().fit(extent, {
      padding: [48, 48, 48, 48],
      duration: 120,
      maxZoom: 18
    })
  }
}

function toSceneSource(config: BasemapConfig): SceneSource {
  if (config.type === 'osm') {
    return {
      type: 'xyz',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }
  }
  if (config.type === 'xyz') {
    return {
      type: 'xyz',
      url: config.url,
      attribution: config.attribution,
      maxZoom: config.maxZoom
    }
  }
  if (config.type === 'tianditu') {
    return {
      type: 'provider',
      provider: 'tianditu',
      mapType: config.mapType,
      projection: config.projection,
      withLabels: config.withLabels,
      credential: config.credential
    }
  }
  return {
    type: 'provider',
    provider: 'google-map-tiles',
    mapType: config.mapType,
    language: config.language,
    region: config.region,
    credential: config.credential
  }
}

function estimateScale(zoom: number): string {
  const denominator = Math.max(500, Math.round(559082264 / Math.pow(2, zoom)))
  return `1:${denominator.toLocaleString()}`
}
