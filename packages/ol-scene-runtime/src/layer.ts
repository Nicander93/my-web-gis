import type {
  GeoJsonSource,
  GoogleMapTilesSource,
  ProviderSource,
  SceneLayer,
  SceneSource,
  TiandituSource,
  WmsSceneSource,
  WmtsSceneSource,
  XyzSource
} from '@desktop-webgis/scene-schema'
import { createSceneWmsLayer, createSceneWmtsLayer } from './service-layers.js'
import type Feature from 'ol/Feature.js'
import GeoJSON from 'ol/format/GeoJSON.js'
import type Geometry from 'ol/geom/Geometry.js'
import type BaseLayer from 'ol/layer/Base.js'
import LayerGroup from 'ol/layer/Group.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import XYZ from 'ol/source/XYZ.js'
import VectorSource from 'ol/source/Vector.js'
import TileGrid from 'ol/tilegrid/TileGrid.js'
import { transformExtent } from 'ol/proj.js'
import type { Size } from 'ol/size.js'
import type View from 'ol/View.js'
import { createOlStyleFunction } from './style.js'

export const SCENE_LAYER_ID = 'sceneLayerId'

export interface CreateOlSceneLayerOptions {
  credentials?: Record<string, string>
  fetch?: typeof globalThis.fetch
  signal?: AbortSignal
  /** A caller-owned source; layer disposal must not dispose it. */
  vectorSource?: VectorSource<Feature<Geometry>>
}

interface GoogleMapTilesSession {
  session: string
  expiry?: string
  tileWidth: number
  tileHeight: number
  imageFormat?: string
}

interface GoogleMapTilesContext {
  credential: string
  session: string
  source: XYZ
}

export const GOOGLE_MAP_TILES_CONTEXT = 'googleMapTilesContext'
const GOOGLE_MAPS_ATTRIBUTION =
  '<a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">Google Maps</a>'

function applyFeatureId(feature: Feature<Geometry>, source: GeoJsonSource): void {
  if (feature.getId() !== undefined || !source.idField) return
  const value = feature.get(source.idField)
  if (typeof value === 'string' || typeof value === 'number') feature.setId(value)
}

function createVectorSource(source: GeoJsonSource, view: View): VectorSource<Feature<Geometry>> {
  const format = new GeoJSON({
    dataProjection: source.dataProjection ?? 'EPSG:4326',
    featureProjection: view.getProjection()
  })
  const vectorSource = new VectorSource<Feature<Geometry>>({
    format,
    ...(source.data ? { features: format.readFeatures(source.data) as Feature<Geometry>[] } : {}),
    ...(source.url ? { url: source.url } : {})
  })

  vectorSource.getFeatures().forEach((feature) => applyFeatureId(feature, source))
  vectorSource.on('addfeature', (event) => {
    if (event.feature) applyFeatureId(event.feature, source)
  })
  return vectorSource
}

function createXyzLayer(source: XyzSource): TileLayer<XYZ> {
  return new TileLayer({
    source: new XYZ({
      url: source.url,
      crossOrigin: source.crossOrigin,
      maxZoom: source.maxZoom,
      attributions: source.attribution
    })
  })
}

function requireCredential(source: ProviderSource, options: CreateOlSceneLayerOptions): string {
  const value = options.credentials?.[source.credential]
  if (!value) {
    throw new Error(
      `Provider “${source.provider}” 缺少运行时 Credential “${source.credential}”`
    )
  }
  return value
}

function createTiandituUrl(layerCode: string, matrixSet: 'w' | 'c', credential: string): string {
  return (
    `https://t{0-7}.tianditu.gov.cn/${layerCode}_${matrixSet}/wmts` +
    '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
    `&LAYER=${layerCode}&STYLE=default&TILEMATRIXSET=${matrixSet}&FORMAT=tiles` +
    '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}' +
    `&tk=${encodeURIComponent(credential)}`
  )
}

function createTianditu4326Source(layerCode: string, credential: string, attribution: string): XYZ {
  const resolutions = Array.from({ length: 18 }, (_, zoom) => 0.703125 / 2 ** zoom)
  const tileGrid = new TileGrid({
    extent: [-180, -90, 180, 90],
    origin: [-180, 90],
    resolutions,
    tileSize: 256
  })
  return new XYZ({
    projection: 'EPSG:4326',
    tileGrid,
    maxZoom: 17,
    attributions: attribution,
    tileUrlFunction: (tileCoord) => {
      if (!tileCoord) return undefined
      const [zoom, column, row] = tileCoord
      const subdomain = Math.abs(column + row) % 8
      return (
        `https://t${subdomain}.tianditu.gov.cn/${layerCode}_c/wmts` +
        '?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
        `&LAYER=${layerCode}&STYLE=default&TILEMATRIXSET=c&FORMAT=tiles` +
        `&TILEMATRIX=${zoom + 1}&TILEROW=${row}&TILECOL=${column}` +
        `&tk=${encodeURIComponent(credential)}`
      )
    }
  })
}

function createTiandituLayer(source: TiandituSource, options: CreateOlSceneLayerOptions): BaseLayer {
  const credential = requireCredential(source, options)
  const codes =
    source.mapType === 'vector'
      ? { base: 'vec', label: 'cva' }
      : source.mapType === 'imagery'
        ? { base: 'img', label: 'cia' }
        : { base: 'ter', label: 'cta' }
  const attribution = '天地图 GS(2024)0568号'
  const createSource = (layerCode: string): XYZ =>
    source.projection === 'EPSG:4326'
      ? createTianditu4326Source(layerCode, credential, attribution)
      : new XYZ({
          url: createTiandituUrl(layerCode, 'w', credential),
          maxZoom: 18,
          attributions: attribution
        })
  const layers: BaseLayer[] = [
    new TileLayer({ source: createSource(codes.base) })
  ]
  if (source.withLabels ?? true) {
    layers.push(new TileLayer({ source: createSource(codes.label) }))
  }
  return new LayerGroup({ layers })
}

async function createGoogleMapTilesLayer(
  source: GoogleMapTilesSource,
  options: CreateOlSceneLayerOptions
): Promise<BaseLayer> {
  const credential = requireCredential(source, options)
  const fetcher = options.fetch ?? globalThis.fetch
  if (!fetcher) throw new Error('当前环境不支持 fetch，无法创建 Google Map Tiles Session')

  const requestBody: Record<string, unknown> = {
    mapType: source.mapType,
    language: source.language,
    region: source.region
  }
  if (source.mapType === 'terrain') requestBody.layerTypes = ['layerRoadmap']

  const response = await fetcher(
    `https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(credential)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: options.signal
    }
  )
  if (!response.ok) throw new Error(`Google Map Tiles Session 创建失败：HTTP ${response.status}`)
  const session = (await response.json()) as Partial<GoogleMapTilesSession>
  if (
    typeof session.session !== 'string' ||
    typeof session.tileWidth !== 'number' ||
    typeof session.tileHeight !== 'number'
  ) {
    throw new Error('Google Map Tiles Session 响应格式无效')
  }

  const tileSource = new XYZ({
    url:
      'https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}' +
      `?session=${encodeURIComponent(session.session)}&key=${encodeURIComponent(credential)}`,
    tileSize: [session.tileWidth, session.tileHeight],
    maxZoom: 22,
    crossOrigin: 'anonymous',
    attributions: [GOOGLE_MAPS_ATTRIBUTION]
  })
  const layer = new TileLayer({ source: tileSource })
  layer.set(GOOGLE_MAP_TILES_CONTEXT, {
    credential,
    session: session.session,
    source: tileSource
  } satisfies GoogleMapTilesContext)
  return layer
}

async function createProviderLayer(
  source: ProviderSource,
  options: CreateOlSceneLayerOptions
): Promise<BaseLayer> {
  options.signal?.throwIfAborted()
  if (source.provider === 'tianditu') return createTiandituLayer(source, options)
  return createGoogleMapTilesLayer(source, options)
}

/** Refreshes the copyright text required by Google for the current viewport. */
export async function updateGoogleMapTilesAttribution(
  layer: BaseLayer,
  view: View,
  size: Size | undefined,
  fetcher: typeof globalThis.fetch | undefined = globalThis.fetch
): Promise<void> {
  const context = layer.get(GOOGLE_MAP_TILES_CONTEXT) as GoogleMapTilesContext | undefined
  if (!context || !size || !fetcher) return
  const [west, south, east, north] = transformExtent(
    view.calculateExtent(size),
    view.getProjection(),
    'EPSG:4326'
  )
  const query = new URLSearchParams({
    session: context.session,
    key: context.credential,
    zoom: String(Math.max(0, Math.round(view.getZoom() ?? 0))),
    north: String(Math.min(90, north)),
    south: String(Math.max(-90, south)),
    east: String(Math.min(180, east)),
    west: String(Math.max(-180, west))
  })
  const response = await fetcher(`https://tile.googleapis.com/tile/v1/viewport?${query}`)
  if (!response.ok) throw new Error(`Google Map Tiles 署名加载失败：HTTP ${response.status}`)
  const result = (await response.json()) as { copyright?: unknown }
  context.source.setAttributions(
    typeof result.copyright === 'string' && result.copyright.length > 0
      ? [GOOGLE_MAPS_ATTRIBUTION, result.copyright]
      : [GOOGLE_MAPS_ATTRIBUTION]
  )
}

/** Converts one scene layer definition into its OpenLayers runtime layer. */
export async function createOlSceneLayer(
  definition: SceneLayer,
  sources: Record<string, SceneSource>,
  view: View,
  options: CreateOlSceneLayerOptions = {}
): Promise<BaseLayer> {
  options.signal?.throwIfAborted()
  if (definition.type === 'tile') {
    const sourceDefinition = sources[definition.source]
    if (!sourceDefinition) throw new Error(`Layer “${definition.id}” 引用的 Source “${definition.source}” 不存在`)
    if (sourceDefinition.type === 'geojson') {
      throw new Error(`Tile Layer “${definition.id}” 不能引用 GeoJSON Source`)
    }
    let layer
    if (sourceDefinition.type === 'xyz') {
      layer = createXyzLayer(sourceDefinition)
    } else if (sourceDefinition.type === 'wms') {
      layer = createSceneWmsLayer(sourceDefinition as WmsSceneSource, {
        visible: definition.visible,
        opacity: definition.opacity
      })
    } else if (sourceDefinition.type === 'wmts') {
      layer = createSceneWmtsLayer(sourceDefinition as WmtsSceneSource, {
        visible: definition.visible,
        opacity: definition.opacity
      })
    } else if (sourceDefinition.type === 'provider') {
      layer = await createProviderLayer(sourceDefinition, options)
    } else {
      throw new Error(`Tile Layer "${definition.id}" 不支持 Source 类型 "${(sourceDefinition as { type?: string }).type}"`)
    }
    layer.setVisible(definition.visible ?? true)
    layer.setOpacity(definition.opacity ?? 1)
    layer.setMinZoom(definition.minZoom ?? Number.NEGATIVE_INFINITY)
    layer.setMaxZoom(definition.maxZoom ?? Number.POSITIVE_INFINITY)
    layer.set(SCENE_LAYER_ID, definition.id)
    return layer
  }

  const sourceDefinition = sources[definition.source]
  if (!sourceDefinition) throw new Error(`Layer “${definition.id}” 引用的 Source “${definition.source}” 不存在`)
  if (sourceDefinition.type !== 'geojson') {
    throw new Error(`Vector Layer “${definition.id}” 必须引用 GeoJSON Source`)
  }
  const source = options.vectorSource ?? createVectorSource(sourceDefinition, view)
  const layer = new VectorLayer({
    visible: definition.visible,
    opacity: definition.opacity,
    minZoom: definition.minZoom,
    maxZoom: definition.maxZoom,
    source,
    style: createOlStyleFunction(definition.style)
  })
  layer.set(SCENE_LAYER_ID, definition.id)
  return layer
}
