import type { ProcessingRecord } from './processing'
import type { SceneDocument } from '@desktop-webgis/scene-schema'

export type Position = [number, number] | [number, number, number]

export interface PointGeometry {
  type: 'Point'
  coordinates: Position
}

export interface MultiPointGeometry {
  type: 'MultiPoint'
  coordinates: Position[]
}

export interface LineStringGeometry {
  type: 'LineString'
  coordinates: Position[]
}

export interface MultiLineStringGeometry {
  type: 'MultiLineString'
  coordinates: Position[][]
}

export interface PolygonGeometry {
  type: 'Polygon'
  coordinates: Position[][]
}

export interface MultiPolygonGeometry {
  type: 'MultiPolygon'
  coordinates: Position[][][]
}

export type Geometry =
  | PointGeometry
  | MultiPointGeometry
  | LineStringGeometry
  | MultiLineStringGeometry
  | PolygonGeometry
  | MultiPolygonGeometry

export interface GisFeature {
  id: string
  geometry: Geometry
  properties: Record<string, unknown>
  metadata?: {
    sourceId?: string | number
    overlaySourceId?: string
    sourceCrs?: string
    importId?: string
    /** Host mapping for typed public scene IDs; omitted from portable feature metadata. */
    sceneFeatureId?: string | number
    sceneMetadataPresent?: boolean
  }
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

/** Declared columns survive empty datasets and are independent of current feature values. */
export interface DatasetField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'json'
  nullable: boolean
}

export type VectorDataset = {
  id: string
  name: string
  kind: 'vector'
  fields?: DatasetField[]
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

export type LayerStyleKind = 'point' | 'line' | 'polygon' | 'mixed'

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

export interface Layer {
  id: string
  datasetId: string
  name: string
  visible: boolean
  opacity: number
  editable: boolean
  style: LegacyLayerStyle | import('@desktop-webgis/ol-style').LayerStyle
  /** Persisted field filter (F). Empty/undefined ⇒ F = A. */
  filter?: import('./filter').FieldFilterCondition[]
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
}

/** Top-level LayerPanel entry: an ungrouped layer or a single-level group. */
export type LayerTreeEntry =
  | { type: 'layer'; id: string }
  | { type: 'group'; id: string }

export interface Project {
  /** Optional city scene; legacy 2D projects remain readable. */
  city?: import('@desktop-webgis/cesium-scene-schema').CityScene
  id: string
  version: number
  name: string
  crs: string
  /** Portable scene description and JSON metadata, retained in project snapshots. */
  description?: string
  metadata?: SceneDocument['metadata']
  /** Viewer presentation is content; desktop layout preferences remain separate. */
  sceneDisplay?: Pick<SceneDocument, 'widgets' | 'theme' | 'presentation'>
  datasets: Dataset[]
  layers: Layer[]
  /** Single-level groups. Absent/empty on legacy projects until normalizeLayerTree. */
  groups: LayerGroup[]
  /**
   * Top-level list order (ungrouped layers + groups).
   * Index 0 = top of list = highest map z-index.
   */
  rootOrder: LayerTreeEntry[]
  mapState: MapState
  basemap: BasemapConfig
  settings: Record<string, unknown>
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
