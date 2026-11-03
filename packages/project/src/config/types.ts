import type { ProcessingOptions } from '@desktop-webgis/spatial-analysis'
import type { ResourceReference } from '@desktop-webgis/cesium-scene-schema'

import type { DatasetField, GisFeature, LayerStyleKind } from '../data/types'
export type {
  Position,
  PointGeometry,
  MultiPointGeometry,
  LineStringGeometry,
  MultiLineStringGeometry,
  PolygonGeometry,
  MultiPolygonGeometry,
  Geometry,
  GisFeature,
  DatasetField,
  LayerStyleKind
} from '../data/types'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface PopupField {
  field: string
  label?: string
  format?: 'text' | 'number' | 'date' | 'url'
}
export interface PopupDefinition {
  titleField?: string
  fields: PopupField[]
}
export interface LayerInteraction {
  selectable?: boolean
  popup?: PopupDefinition
}
export interface SceneWidgets {
  layerSwitcher?: boolean
  legend?: boolean
  scaleLine?: boolean
  fullscreen?: boolean
  zoom?: boolean
  mousePosition?: boolean
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
  view: { projection: string; center: [number, number]; zoom: number; rotation?: number; minZoom?: number; maxZoom?: number; extent?: [number, number, number, number] }
  visibleLayers?: string[]
  highlightedFeatureIds?: string[]
}
export interface ScenePresentation {
  chapters?: SceneChapter[]
}
export interface SceneDisplay {
  widgets?: SceneWidgets
  theme?: SceneTheme
  presentation?: ScenePresentation
}
export interface MapViewConstraints {
  extent?: [number, number, number, number]
  minZoom?: number
  maxZoom?: number
}

export interface ProcessingRecord {
  engine?: { id: string; version: string; tool: string }
  options: ProcessingOptions
  sourceLayerId: string
  sourceLayerName: string
  scope: 'all' | 'filtered' | 'selected'
  inputCount: number
  outputCount: number
  completedAt: string
  overlay?: { layerId: string; layerName: string; scope: 'all' | 'filtered' | 'selected'; inputCount: number }
}

/** Local / imported vector sources (files, memory). */
export type LocalVectorSource =
  | {
      type: 'geojson-file'
      path: string
    }
  | {
      type: 'geojson-url'
      url: string
    }
  | {
      type: 'memory'
      label: string
    }
  | {
      type: 'shapefile-file'
      path: string
    }
  | {
      type: 'dxf-file'
      path: string
    }

/** @deprecated Use LocalVectorSource; kept as alias for existing imports. */
export type DataSource = LocalVectorSource

export type DatasetKind = 'vector' | 'wms' | 'wmts' | 'wfs'

/** Auth mode for OGC service connections. Secrets are never stored on Dataset. */
export type ServiceAuthMode = 'none' | 'query-token' | 'bearer'

/** Reference to a credential held outside the project (secure store / session). */
export interface CredentialRef {
  key: string
}

export interface WmsServiceSource {
  type: 'wms'
  /** Shareable service URL with non-secret query params; tokens stripped. */
  url: string
  version: string
  layerNames: string[]
  styleNames?: string[]
  format?: string
  transparent?: boolean
  /** Preferred request CRS/SRS when advertised by capabilities. */
  crs?: string
  /** WGS84 geographic extent [west, south, east, north] for zoom-to and persistence. */
  bboxWgs84?: [number, number, number, number]
  authMode: ServiceAuthMode
  /** Query-token parameter name when authMode is query-token (value not persisted). */
  tokenParam?: string
  credentialRef?: CredentialRef
}

/** Persisted TileMatrix level so reopen does not need Capabilities. */
export interface WmtsPersistedMatrix {
  identifier: string
  scaleDenominator: number
  /** TopLeftCorner as advertised (SupportedCRS axis order). */
  topLeftCorner: [number, number]
  tileWidth: number
  tileHeight: number
  matrixWidth?: number
  matrixHeight?: number
}

export interface WmtsServiceSource {
  type: 'wmts'
  /**
   * Shareable KVP service base or first REST template (no secrets).
   * Prefer `urls` when multiple templates / GetTile endpoints exist.
   */
  url: string
  version: string
  layer: string
  style?: string
  format?: string
  tileMatrixSet: string
  /** KVP or REST as declared by capabilities. */
  requestEncoding: 'KVP' | 'REST'
  /** KVP GetTile bases or REST templates — credentials never embedded. */
  urls?: string[]
  /** Normalized projection of the TileMatrixSet (EPSG:3857 / EPSG:4326). */
  projection?: string
  /** Raw SupportedCRS string from capabilities. */
  supportedCrs?: string
  /** WGS84 geographic extent for zoom-to. */
  bboxWgs84?: [number, number, number, number]
  /** Real matrix definitions (origin / scale / id / tile size) — not XYZ zoom guesses. */
  tileMatrices: WmtsPersistedMatrix[]
  authMode: ServiceAuthMode
  tokenParam?: string
  credentialRef?: CredentialRef
}

export interface WfsServiceSource {
  type: 'wfs'
  url: string
  version: string
  typeName: string
  outputFormat?: string
  /** Product guardrail (default 5000, phase max 50000). */
  maxFeatures?: number
  srsName?: string
  /** Feature-type advertised WGS84 extent when known. */
  bboxWgs84?: [number, number, number, number]
  /** Last successful query extent (WGS84). */
  queryExtentWgs84?: [number, number, number, number]
  extentMode?: 'view' | 'full'
  /** True when paging was used on last load. */
  paginationUsed?: boolean
  /** Features present in the local snapshot after last successful load/refresh. */
  loadedCount?: number
  /**
   * False when truncated by limit, cancelled mid-page kept partial, or later page failed.
   * Never present truncated results as complete.
   */
  complete?: boolean
  truncatedByLimit?: boolean
  duplicateIdCount?: number
  /** ISO timestamp of last successful snapshot replace. */
  lastLoadedAt?: string
  authMode: ServiceAuthMode
  tokenParam?: string
  credentialRef?: CredentialRef
}

export type ServiceSource = WmsServiceSource | WmtsServiceSource | WfsServiceSource

export type VectorDataset = {
  id: string
  name: string
  kind: 'vector'
  /** Declared source CRS only; cached feature coordinates remain WGS84. */
  sourceCrs?: string
  fields?: DatasetField[]
  /** Explicit managed data destination; original import/source provenance remains separate. */
  storage?: { type: 'managed-geojson'; reference: Exclude<ResourceReference, { kind: 'url' }> }
  source: LocalVectorSource
  processing?: ProcessingRecord
}

export type WmsDataset = {
  id: string
  name: string
  kind: 'wms'
  fields?: DatasetField[]
  source: WmsServiceSource
}

export type WmtsDataset = {
  id: string
  name: string
  kind: 'wmts'
  fields?: DatasetField[]
  source: WmtsServiceSource
}

export type WfsDataset = {
  id: string
  name: string
  kind: 'wfs'
  fields?: DatasetField[]
  source: WfsServiceSource
}

/** Discriminable Dataset union: vector snapshot vs WMS vs WMTS vs WFS. */
export type Dataset = VectorDataset | WmsDataset | WmtsDataset | WfsDataset

/**
 * @deprecated 旧的简单样式定义,仅用于迁移
 */
export interface LegacyLayerStyle {
  kind: LayerStyleKind
  stroke: string
  fill: string
  width: number
  pointRadius: number
}

export interface PublishedStyleLink {
  connectionId: string
  workspace: string
  store?: string
  layerName: string
  styleName: string
  remoteFormat: 'sld' | 'mbstyle'
  lastPublishedHash: string
  lastPublishedAt: string
  lastPublishedContentHash: string
}

export interface Layer {
  id: string
  datasetId: string
  name: string
  visible: boolean
  opacity: number
  editable: boolean
  /** Local configuration lock; independent of legacy editing state. */
  locked?: boolean
  style: LegacyLayerStyle | import('@desktop-webgis/ol-style').LayerStyle
  /** Persisted field filter (F). Empty/undefined ⇒ F = A. */
  filter?: import('../data/filter').FieldFilterCondition[]
  minZoom?: number
  maxZoom?: number
  interaction?: LayerInteraction
  publishedStyle?: PublishedStyleLink
}

export interface MapState {
  center: [number, number]
  zoom: number
  rotation: number
}

export type BasemapConfig =
  | { type: 'osm' }
  | { type: 'xyz'; url: string; attribution?: string; maxZoom?: number }
  | {
      type: 'tianditu'
      mapType: 'vector' | 'imagery' | 'terrain'
      projection?: 'EPSG:3857' | 'EPSG:4326'
      withLabels?: boolean
      credential: string
    }
  | {
      type: 'google-map-tiles'
      mapType: 'roadmap' | 'satellite' | 'terrain'
      language: string
      region: string
      credential: string
    }


export interface LayerGroup {
  id: string
  name: string
  /** Group-level visibility. When false, children are hidden on the map but keep their own `visible`. */
  visible: boolean
  /** Ordered child layer IDs (references only — never copies Datasets). */
  layerIds: string[]
  /** Optional for legacy single-level projects. */
  parentId?: string
  locked?: boolean
  /** Mixed folder/layer sibling order; legacy layerIds remain membership references. */
  childOrder?: LayerTreeEntry[]
}

/** Tree entry: a layer or a freely nested folder. */
export type LayerTreeEntry =
  | { type: 'layer'; id: string }
  | { type: 'group'; id: string }

/** Legacy file input only. Runtime state uses Project below. */
export interface LegacyProject {
  /** Standard v8 layers; absent only on legacy in-memory inputs before migration. */
  cartography?: import('@desktop-webgis/ol-style/cartography-model').CartographyState
  /** 旧工程文件里的三维场景字段名；读入后写入 content.scene。 */
  city?: import('@desktop-webgis/cesium-scene-schema').CesiumScene
  id: string
  version: number
  name: string
  crs: string
  /** Portable scene description and JSON metadata, retained in project snapshots. */
  description?: string
  metadata?: Record<string, JsonValue>
  /** Viewer presentation is content; desktop layout preferences remain separate. */
  sceneDisplay?: SceneDisplay
  datasets: Dataset[]
  layers: Layer[]
  /** Nested folders; legacy single-level groups remain readable. */
  groups: LayerGroup[]
  /**
   * Top-level list order (ungrouped layers + groups).
   * Index 0 = top of list = highest map z-index.
   */
  rootOrder: LayerTreeEntry[]
  mapState: MapState
  /** Content constraints survive live camera snapshots and navigation updates. */
  mapViewConstraints?: MapViewConstraints
  basemap: BasemapConfig
  settings: Record<string, unknown>
}

export interface ProjectMetadata {
  id: string
  name: string
  formatVersion: number
  description?: string
  sceneMetadata?: Record<string, JsonValue>
}

export interface MapContent {
  kind: 'map2d'
  cartography?: import('@desktop-webgis/ol-style/cartography-model').CartographyState
  scene?: never
  crs: string
  datasets: Dataset[]
  layers: Layer[]
  groups: LayerGroup[]
  rootOrder: LayerTreeEntry[]
  initialView: MapState
  viewConstraints?: LegacyProject['mapViewConstraints']
  display?: LegacyProject['sceneDisplay']
  basemap: BasemapConfig
  settings: Record<string, unknown>
}

export interface SceneContent {
  kind: 'scene3d'
  scene: import('@desktop-webgis/cesium-scene-schema').CesiumScene
  settings: Record<string, unknown>
  display?: LegacyProject['sceneDisplay']
}

export type ProjectContent = MapContent | SceneContent

export interface Project {
  metadata: ProjectMetadata
  content: ProjectContent
}

export interface SelectionState {
  layerId: string | null
  featureIds: string[]
}

export type EditTool =
  | 'none'
  | 'pan'
  | 'select'
  | 'draw-point'
  | 'draw-line'
  | 'draw-polygon'
  | 'modify'
  | 'delete'

export interface ProjectSnapshot {
  project: Project
  featuresByDataset: Record<string, GisFeature[]>
}
