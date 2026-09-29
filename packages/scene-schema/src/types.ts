/**
 * SceneManifest types.
 *
 * version 1: single-symbol SceneStyle + optional LabelStyle (legacy, still readable).
 * version 2: shared LayerStyle-shaped contract (single / categorized / graduated + label).
 * Protocol packages stay free of OpenLayers runtime imports.
 */

export const SCENE_MANIFEST_VERSION = 2 as const
export const SCENE_MANIFEST_VERSION_V1 = 1 as const

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

/** Shareable WMS source for Scene 鈥?never embeds secret token values. */
export interface WmsSceneSource {
  type: 'wms'
  url: string
  version: string
  layerNames: string[]
  styleNames?: string[]
  format?: string
  transparent?: boolean
  crs?: string
  bboxWgs84?: [number, number, number, number]
  /** none = no auth; runtime = Viewer/runtime must supply credentials separately. */
  authMode: 'none' | 'runtime'
}

/** Persisted WMTS matrix level (same shape as project, no secrets). */
export interface WmtsSceneMatrix {
  identifier: string
  scaleDenominator: number
  topLeftCorner: [number, number]
  tileWidth: number
  tileHeight: number
  matrixWidth?: number
  matrixHeight?: number
}

export interface WmtsSceneSource {
  type: 'wmts'
  url: string
  version: string
  layer: string
  style?: string
  format?: string
  tileMatrixSet: string
  requestEncoding: 'KVP' | 'REST'
  urls?: string[]
  projection?: string
  supportedCrs?: string
  bboxWgs84?: [number, number, number, number]
  tileMatrices: WmtsSceneMatrix[]
  authMode: 'none' | 'runtime'
}

export type SceneSource = GeoJsonSource | XyzSource | ProviderSource | WmsSceneSource | WmtsSceneSource

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

/** v1 single-symbol style (CSS color strings). Kept for reading old documents. */
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

/**
 * Shared style contract (structurally aligned with @desktop-webgis/ol-style LayerStyle).
 * Pure JSON types only — no OpenLayers imports.
 */
export interface SceneColor {
  r: number
  g: number
  b: number
  a: number
}

export interface ScenePointSymbol {
  type: 'circle'
  radius: number
  fill?: SceneColor
  stroke?: SceneColor
  strokeWidth?: number
}

export interface SceneLineSymbol {
  type: 'solid'
  color: SceneColor
  width: number
  lineDash?: number[]
}

export interface ScenePolygonSymbol {
  type: 'solid'
  fill?: SceneColor
  stroke?: SceneColor
  strokeWidth?: number
  lineDash?: number[]
}

export interface SceneMixedSymbol {
  type: 'mixed'
  point?: ScenePointSymbol
  line?: SceneLineSymbol
  polygon?: ScenePolygonSymbol
}

export type SceneSymbol = ScenePointSymbol | SceneLineSymbol | ScenePolygonSymbol | SceneMixedSymbol

export interface SceneCategoryItem {
  value: number | string
  symbol: SceneSymbol
  label?: string
}

export interface SceneGraduatedBreak {
  value: number
  symbol: SceneSymbol
  label?: string
}

export interface SceneLabelConfig {
  field: string
  fontSize?: number
  color?: SceneColor
  strokeColor?: SceneColor
  strokeWidth?: number
  offsetX?: number
  offsetY?: number
  minZoom?: number
  maxZoom?: number
}

export interface SceneSingleStyle {
  mode: 'single'
  symbol: SceneSymbol
  label?: SceneLabelConfig
}

export interface SceneCategorizedStyle {
  mode: 'categorized'
  field: string
  categories: SceneCategoryItem[]
  fallback: SceneSymbol
  label?: SceneLabelConfig
}

export interface SceneGraduatedStyle {
  mode: 'graduated'
  field: string
  method: 'equal-interval' | 'quantile' | 'manual'
  breaks: SceneGraduatedBreak[]
  fallback: SceneSymbol
  label?: SceneLabelConfig
}

export type SceneLayerStyle = SceneSingleStyle | SceneCategorizedStyle | SceneGraduatedStyle

/** Raw vector layer as it appears in a version 1 document. */
export interface VectorLayerV1 extends SceneLayerBase {
  type: 'vector'
  source: string
  style: SceneStyle
  label?: LabelStyle
  interaction?: LayerInteraction
}

/** Canonical vector layer after migration / for new writes (version 2). */
export interface VectorLayer extends SceneLayerBase {
  type: 'vector'
  source: string
  style: SceneLayerStyle
  interaction?: LayerInteraction
}

export type SceneLayer = TileLayer | VectorLayer
export type SceneLayerInput = TileLayer | VectorLayer | VectorLayerV1

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

interface SceneManifestBase {
  $schema?: string
  id: string
  title: string
  description?: string
  view: SceneView
  credentials?: Record<string, SceneCredentialReference>
  sources: Record<string, SceneSource>
  widgets?: SceneWidgets
  theme?: SceneTheme
  presentation?: ScenePresentation
  metadata?: Record<string, JsonValue>
}

export interface SceneManifestV1 extends SceneManifestBase {
  version: 1
  layers: Array<TileLayer | VectorLayerV1>
}

export interface SceneManifestV2 extends SceneManifestBase {
  version: 2
  layers: SceneLayer[]
}

/** Canonical in-memory / write form after parse/migrate. */
export type SceneManifest = SceneManifestV2

/** Accepted on-disk / API input before migration. */
export type SceneManifestInput = SceneManifestV1 | SceneManifestV2

export interface ValidationIssue {
  path: string
  code: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}
