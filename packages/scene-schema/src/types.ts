export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type GeoJsonPosition = number[]

export type GeoJsonGeometry =
  | { type: 'Point'; coordinates: GeoJsonPosition }
  | { type: 'MultiPoint'; coordinates: GeoJsonPosition[] }
  | { type: 'LineString'; coordinates: GeoJsonPosition[] }
  | { type: 'MultiLineString'; coordinates: GeoJsonPosition[][] }
  | { type: 'Polygon'; coordinates: GeoJsonPosition[][] }
  | { type: 'MultiPolygon'; coordinates: GeoJsonPosition[][][] }
  | { type: 'GeometryCollection'; geometries: GeoJsonGeometry[] }

export interface GeoJsonFeature {
  type: 'Feature'
  id?: string | number
  geometry: GeoJsonGeometry | null
  properties: Record<string, JsonValue> | null
}

export interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

export interface SceneView {
  projection: string
  center: [number, number]
  zoom: number
  rotation?: number
  minZoom?: number
  maxZoom?: number
  extent?: [number, number, number, number]
}

export interface GeoJsonSource {
  type: 'geojson'
  data?: GeoJsonFeatureCollection
  url?: string
  dataProjection?: string
  idField?: string
}

export interface XyzSource {
  type: 'xyz'
  url: string
  crossOrigin?: 'anonymous' | 'use-credentials'
  maxZoom?: number
  attribution?: string
}

export interface TiandituSource {
  type: 'provider'
  provider: 'tianditu'
  mapType: 'vector' | 'imagery' | 'terrain'
  projection?: 'EPSG:3857' | 'EPSG:4326'
  withLabels?: boolean
  credential: string
}

export interface GoogleMapTilesSource {
  type: 'provider'
  provider: 'google-map-tiles'
  mapType: 'roadmap' | 'satellite' | 'terrain'
  language: string
  region: string
  credential: string
}

export type ProviderSource = TiandituSource | GoogleMapTilesSource
export type SceneSource = GeoJsonSource | XyzSource | ProviderSource

export interface SceneCredentialReference {
  type: 'runtime-reference'
  key: string
}

export interface SceneLayerBase {
  id: string
  name: string
  visible?: boolean
  opacity?: number
  minZoom?: number
  maxZoom?: number
  role?: 'basemap' | 'overlay'
}

export interface TileLayer extends SceneLayerBase {
  type: 'tile'
  source: string
}

export interface VectorLayer extends SceneLayerBase {
  type: 'vector'
  source: string
  style: SceneStyle
  label?: LabelStyle
  interaction?: LayerInteraction
}

export type SceneLayer = TileLayer | VectorLayer

export interface PointStyle {
  type: 'point'
  radius: number
  fill: string
  stroke?: string
  strokeWidth?: number
}

export interface LineStyle {
  type: 'line'
  color: string
  width: number
  lineDash?: number[]
}

export interface PolygonStyle {
  type: 'polygon'
  fill: string
  stroke: string
  strokeWidth: number
  lineDash?: number[]
}

export type SceneStyle = PointStyle | LineStyle | PolygonStyle

export interface LabelStyle {
  field: string
  color?: string
  font?: string
  haloColor?: string
  haloWidth?: number
  offset?: [number, number]
  minZoom?: number
  maxZoom?: number
}

export interface LayerInteraction {
  selectable?: boolean
  popup?: PopupDefinition
}

export interface PopupDefinition {
  titleField?: string
  fields: PopupField[]
}

export interface PopupField {
  field: string
  label?: string
  format?: 'text' | 'number' | 'date' | 'url'
}

export interface SceneWidgets {
  layerSwitcher?: boolean
  legend?: boolean
  scaleLine?: boolean
  fullscreen?: boolean
  zoom?: boolean
  mousePosition?: boolean
}

export interface ScenePresentation {
  chapters?: SceneChapter[]
}

export interface SceneTheme {
  preset?: string
  colorScheme?: 'light' | 'dark' | 'system'
  accent?: string
  surface?: 'solid' | 'glass'
  fontFamily?: string
  logo?: string
}

export interface SceneChapter {
  id: string
  title: string
  description?: string
  view: SceneView
  visibleLayers?: string[]
  highlightedFeatureIds?: string[]
}

export interface SceneManifestV1 {
  $schema?: string
  version: 1
  id: string
  title: string
  description?: string
  view: SceneView
  credentials?: Record<string, SceneCredentialReference>
  sources: Record<string, SceneSource>
  layers: SceneLayer[]
  widgets?: SceneWidgets
  theme?: SceneTheme
  presentation?: ScenePresentation
  metadata?: Record<string, JsonValue>
}

export type SceneManifest = SceneManifestV1

export interface ValidationIssue {
  path: string
  code: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}
