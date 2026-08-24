import type { BasemapConfig, GisFeature, Layer, MapState } from '@desktop-webgis/gis-core'
import { createOlSceneLayer, updateGoogleMapTilesAttribution } from '@desktop-webgis/ol-scene-runtime'
import type { SceneSource } from '@desktop-webgis/scene-schema'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import type BaseLayer from 'ol/layer/Base'
import VectorLayer from 'ol/layer/Vector'
import OSM from 'ol/source/OSM'
import VectorSource from 'ol/source/Vector'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import { defaults as defaultInteractions } from 'ol/interaction'
import { boundingExtent, isEmpty } from 'ol/extent'
import type { Coordinate } from 'ol/coordinate'
import { toOlFeature } from '../feature/featureAdapter'
import { OlLayerRegistry } from '../layer/OlLayerRegistry'
import { createLayerStyle } from '../layer/style'

export interface PointerInfo {
  coordinate: Coordinate
  scaleText: string
}

export class OlMapRuntime {
  readonly registry = new OlLayerRegistry()
  private map: Map | null = null
  private basemapLayer: BaseLayer | null = null
  private basemapRevision = 0
  private fetcher: typeof globalThis.fetch | undefined = globalThis.fetch
  private pointerMove?: (info: PointerInfo) => void

  mount(target: HTMLElement, mapState: MapState): Map {
    this.map = new Map({
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

  getMap(): Map {
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

  syncLayers(layers: Layer[], featuresByDataset: Record<string, GisFeature[]>): void {
    const map = this.getMap()
    const liveLayerIds = new Set(layers.map((layer) => layer.id))

    for (const [layerId, runtimeLayer] of this.registry.entries()) {
      if (!liveLayerIds.has(layerId)) {
        map.removeLayer(runtimeLayer)
        this.registry.unregister(layerId)
      }
    }

    layers.forEach((layer, index) => {
      const features = featuresByDataset[layer.datasetId] ?? []
      const existing = this.registry.get(layer.id)
      if (existing) {
        existing.setVisible(layer.visible)
        existing.setOpacity(layer.opacity)
        existing.setStyle(createLayerStyle(layer.style))
        existing.setZIndex(index + 10)
        const source = existing.getSource()
        source?.clear()
        source?.addFeatures(features.map(toOlFeature))
        return
      }

      const source = new VectorSource({
        features: features.map(toOlFeature)
      })
      const vectorLayer = new VectorLayer({
        source,
        visible: layer.visible,
        opacity: layer.opacity,
        style: createLayerStyle(layer.style),
        zIndex: index + 10
      })
      map.addLayer(vectorLayer)
      this.registry.register(layer.id, layer.datasetId, vectorLayer)
    })
  }

  zoomToLayer(layerId: string): void {
    const layer = this.registry.get(layerId)
    const extent = layer?.getSource()?.getExtent()
    if (!extent || isEmpty(extent)) return
    this.getMap().getView().fit(extent, {
      padding: [48, 48, 48, 48],
      duration: 120,
      maxZoom: 18
    })
  }

  zoomToAll(): void {
    const extents = this.registry
      .entries()
      .map(([, layer]) => layer.getSource()?.getExtent())
      .filter((extent): extent is [number, number, number, number] => Boolean(extent && !isEmpty(extent)))
    if (extents.length === 0) return
    const extent = boundingExtent(extents.flatMap((item) => [[item[0], item[1]], [item[2], item[3]]]))
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
