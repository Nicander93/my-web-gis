import { applyFieldFilter,
  isLegacyStyle, migrateLegacyStyle,
  isTileServiceKind,
  layerListZIndex, type BasemapConfig, type Dataset, type GisFeature, type Layer, type MapState, type WmsDataset, type WmtsDataset } from '@desktop-webgis/gis-core'
import { createOlSceneLayer, createOlVectorLayer, updateGoogleMapTilesAttribution, OlDocumentRuntime, type OlDocumentOptions } from '@desktop-webgis/ol-scene-runtime'
import type { SceneSource, SceneDocument } from '@desktop-webgis/scene-schema'
import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import OlMap from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import type BaseLayer from 'ol/layer/Base'
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
  private documentRuntime: OlDocumentRuntime | null = null
  private documentRevision = 0
  private readonly documentSources: Record<string, VectorSource<Feature<Geometry>>> = Object.create(null)
  private readonly documentCredentials: Record<string, string> = Object.create(null)
  private readonly ownedDocumentSources = new Set<VectorSource<Feature<Geometry>>>()
  private configureServiceLayer?: OlDocumentOptions['configureServiceLayer']
  private readonly sourceSnapshots = new Map<string, { features: GisFeature[]; projection: string; source: VectorSource<Feature<Geometry>> }>()

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
      if (!this.map) return
      const base = this.documentRuntime?.getDocument()?.nodes.find(node => node.type === 'tile' && node.role === 'basemap')
      const layer = base ? this.documentRuntime?.getLayer(base.id) : this.basemapLayer
      if (!layer) return
      void updateGoogleMapTilesAttribution(
        layer,
        this.map.getView(),
        this.map.getSize(),
        this.fetcher
      )
    })

    return this.map
  }

  unmount(): void {
    this.documentRevision++
    this.documentRuntime?.destroy()
    this.documentRuntime = null
    this.ownedDocumentSources.forEach(source => this.releaseDocumentSource(source))
    Object.keys(this.documentSources).forEach(id => delete this.documentSources[id])
    this.sourceSnapshots.clear()
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

  /** Prepares portable content around host feature identities; commits registry bindings only on success. */
  async syncDocument(document: SceneDocument, featuresByDataset: Record<string, GisFeature[]>, options: Pick<OlDocumentOptions, 'credentials' | 'configureServiceLayer'> = {}): Promise<boolean> {
    const map = this.getMap(), revision = ++this.documentRevision
    this.documentRuntime?.cancelPreparation()
    const definition = document.views.map
    if (definition?.type !== '2d') throw new Error('Desktop map requires a map view')
    const candidates = new Map<string, { features: GisFeature[]; projection: string; source: VectorSource<Feature<Geometry>> }>()
    const created = new Set<VectorSource<Feature<Geometry>>>()
    try {
      for (const node of document.nodes) {
        if (node.type !== 'vector' || candidates.has(node.resource)) continue
        const features = featuresByDataset[node.resource] ?? [], previous = this.sourceSnapshots.get(node.resource)
        const source = previous?.features === features && previous.projection === definition.projection ? previous.source : new VectorSource({ features: features.map(feature => toOlFeature(feature, definition.projection)) })
        if (source !== previous?.source) { created.add(source); this.ownedDocumentSources.add(source) }
        candidates.set(node.resource, { features, projection: definition.projection, source })
      }
      Object.keys(this.documentSources).forEach(id => delete this.documentSources[id])
      candidates.forEach((value, id) => { this.documentSources[id] = value.source })
      const credentialsChanged = Object.keys(this.documentCredentials).length !== Object.keys(options.credentials ?? {}).length ||
        Object.entries(this.documentCredentials).some(([key, value]) => options.credentials?.[key] !== value)
      this.configureServiceLayer = options.configureServiceLayer
      Object.keys(this.documentCredentials).forEach(id => delete this.documentCredentials[id])
      Object.assign(this.documentCredentials, options.credentials)
      if (!this.documentRuntime) this.documentRuntime = new OlDocumentRuntime({ map, viewId: 'map', vectorSources: this.documentSources, credentials: this.documentCredentials,
        configureServiceLayer: (layer, resource, id) => {
          if (resource.authMode === 'runtime' && !this.configureServiceLayer) throw new Error(`Authenticated service ${id} requires an OL request adapter`)
          return this.configureServiceLayer?.(layer, resource, id)
        }
      })
      const mounted = this.documentRuntime
      const onInstalled = () => {
        const installed = new Set<VectorSource<Feature<Geometry>>>()
        this.registry.clear()
        for (const node of document.nodes) {
          if (node.type !== 'vector' && node.type !== 'tile') continue
          const layer = mounted.getLayer(node.id)
          if (!layer) continue
          const resource = document.resources[node.resource]
          if ((resource.type === 'wms' || resource.type === 'wmts') && resource.bboxWgs84) layer.set(GIS_WMS_EXTENT_KEY, [...resource.bboxWgs84])
          if (node.type !== 'tile' || node.role !== 'basemap') this.registry.register(node.id, node.resource, layer)
          const source = this.registry.getVector(node.id)?.getSource() as VectorSource<Feature<Geometry>> | undefined
          const candidate = candidates.get(node.resource)
          if (source && candidate) { installed.add(source); candidate.source = source }
        }
        this.sourceSnapshots.forEach(entry => { if (!installed.has(entry.source)) this.releaseDocumentSource(entry.source) })
        this.sourceSnapshots.clear()
        candidates.forEach((entry, id) => { if (installed.has(entry.source)) this.sourceSnapshots.set(id, entry) })
        created.forEach(source => { if (!installed.has(source)) this.releaseDocumentSource(source) })
        Object.keys(this.documentSources).forEach(id => delete this.documentSources[id])
        this.sourceSnapshots.forEach((entry, id) => { this.documentSources[id] = entry.source })
        if (this.basemapLayer) { map.removeLayer(this.basemapLayer); this.basemapLayer.dispose(); this.basemapLayer = null }
      }
      if (credentialsChanged) await mounted.loadDocument(document, undefined, { onInstalled })
      else await mounted.updateDocument(document, undefined, { onInstalled })
      return revision === this.documentRevision && this.map === map
    } catch (error) {
      created.forEach(source => this.releaseDocumentSource(source))
      if (revision !== this.documentRevision) return false
      Object.keys(this.documentSources).forEach(id => delete this.documentSources[id])
      this.sourceSnapshots.forEach((entry, id) => { this.documentSources[id] = entry.source })
      throw error
    }
  }

  private releaseDocumentSource(source: VectorSource<Feature<Geometry>>): void {
    if (this.ownedDocumentSources.delete(source)) source.dispose()
  }

  isFeatureIncluded(layerId: string, feature: Feature<Geometry>): boolean {
    return this.documentRuntime?.isFeatureIncluded(layerId, feature) ?? true
  }

  isLayerVisible(layerId: string): boolean {
    const layer = this.registry.getVector(layerId), map = this.getMap()
    if (!layer || !layer.isVisible(map.getView())) return false
    return map.getLayerGroup().getLayerStatesArray().find(state => state.layer === layer)?.visible ?? false
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
        source?.addFeatures(features.map(feature => toOlFeature(feature)))
        return
      }

      // Replace a prior non-vector registration if present.
      const prior = this.registry.get(layer.id)
      if (prior) {
        map.removeLayer(prior)
        this.registry.unregister(layer.id)
      }

      const source = new VectorSource({
        features: features.map(feature => toOlFeature(feature))
      })
      const vectorLayer = createOlVectorLayer({
        type: 'vector', id: layer.id, name: layer.name, source: layer.datasetId,
        visible: layer.visible,
        opacity: layer.opacity,
        style: isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : layer.style
      }, source)
      vectorLayer.setZIndex(zIndex)
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
