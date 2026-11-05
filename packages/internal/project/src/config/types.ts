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

/** 本地和导入的矢量数据源（文件、内存）。 */
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

/** @deprecated 请使用 LocalVectorSource，这里只为现有 import 保留别名。 */
export type DataSource = LocalVectorSource

export type DatasetKind = 'vector' | 'wms' | 'wmts' | 'wfs'

/** OGC 服务连接的认证方式。密钥永远不会保存在 Dataset 上。 */
export type ServiceAuthMode = 'none' | 'query-token' | 'bearer'

/** 指向保存在项目之外的凭据（安全存储或会话）。 */
export interface CredentialRef {
  key: string
}

export interface WmsServiceSource {
  type: 'wms'
  /** 可分享的服务 URL，带非密钥的查询参数，token 已去掉。 */
  url: string
  version: string
  layerNames: string[]
  styleNames?: string[]
  format?: string
  transparent?: boolean
  /** Capabilities 中公布过的首选请求 CRS/SRS。 */
  crs?: string
  /** 用于缩放定位和持久化的 WGS84 地理范围 [西,南,东,北]。 */
  bboxWgs84?: [number, number, number, number]
  authMode: ServiceAuthMode
  /** authMode 为 query-token 时使用的参数名，值不会被持久化。 */
  tokenParam?: string
  credentialRef?: CredentialRef
}

/** 持久化的 TileMatrix 层级，重新打开时不必再拉 Capabilities。 */
export interface WmtsPersistedMatrix {
  identifier: string
  scaleDenominator: number
  /** 按 Capabilities 公布的 TopLeftCorner，坐标轴顺序以 SupportedCRS 为准。 */
  topLeftCorner: [number, number]
  tileWidth: number
  tileHeight: number
  matrixWidth?: number
  matrixHeight?: number
}

export interface WmtsServiceSource {
  type: 'wmts'
  /**
   * 可分享的 KVP 服务基地址，或第一个 REST 模板，不含密钥。
   * 存在多个模板或多个 GetTile 端点时，优先使用 `urls`。
   */
  url: string
  version: string
  layer: string
  style?: string
  format?: string
  tileMatrixSet: string
  /** 按 Capabilities 的声明使用 KVP 或 REST。 */
  requestEncoding: 'KVP' | 'REST'
  /** KVP GetTile bases or REST templates — credentials never embedded. */
  urls?: string[]
  /** TileMatrixSet 规范化之后的投影（EPSG:3857 或 EPSG:4326）。 */
  projection?: string
  /** Capabilities 里原始的 SupportedCRS 字符串。 */
  supportedCrs?: string
  /** 用于缩放定位的 WGS84 地理范围。 */
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
  /** 产品侧的保护上限，默认 5000，当前阶段最大 50000。 */
  maxFeatures?: number
  srsName?: string
  /** 要素类型公布过的 WGS84 范围，未知时为空。 */
  bboxWgs84?: [number, number, number, number]
  /** 最近一次成功查询的范围（WGS84）。 */
  queryExtentWgs84?: [number, number, number, number]
  extentMode?: 'view' | 'full'
  /** 最近一次加载用到了翻页时为 true。 */
  paginationUsed?: boolean
  /** 最近一次成功加载或刷新之后，本地快照中存在的要素。 */
  loadedCount?: number
  /**
   * 因额度被截断、翻页中途取消但保留了部分结果、或后续分页失败时，为 false。
   * 永远不要把被截断的结果当作完整结果。
   */
  complete?: boolean
  truncatedByLimit?: boolean
  duplicateIdCount?: number
  /** 最近一次成功替换快照的 ISO 时间。 */
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
  /** 这里只声明源 CRS；缓存中的要素坐标仍然是 WGS84。 */
  sourceCrs?: string
  fields?: DatasetField[]
  /** 显式指定的托管数据目标；原始的导入和来源信息另行保留。 */
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

/** 可区分的数据集联合类型：矢量快照、WMS、WMTS、WFS。 */
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
  /** 本地的配置锁定，与旧的编辑状态无关。 */
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
  /** 分组级的可见性。为 false 时子节点在地图上隐藏，但它们自己的 `visible` 值不变。 */
  visible: boolean
  /** Ordered child layer IDs (references only — never copies Datasets). */
  layerIds: string[]
  /** 旧的一级项目可以省略这一项。 */
  parentId?: string
  locked?: boolean
  /** 文件夹和图层混排的同级顺序；旧的 layerIds 仍然作为成员引用使用。 */
  childOrder?: LayerTreeEntry[]
}

/** 图层树的一个条目：要么是图层，要么是可以自由嵌套的文件夹。 */
export type LayerTreeEntry =
  | { type: 'layer'; id: string }
  | { type: 'group'; id: string }

/** 这里只处理旧格式的文件输入，运行时状态用下面的 Project。 */
export interface LegacyProject {
  /** 标准的 v8 样式层；只有在迁移之前的旧内存输入里才会缺失。 */
  cartography?: import('@desktop-webgis/ol-style/cartography-model').CartographyState
  /** 旧工程文件里的三维场景字段名；读入后写入 content.scene。 */
  city?: import('@desktop-webgis/cesium-scene-schema').CesiumScene
  id: string
  version: number
  name: string
  crs: string
  /** 可移植的场景描述和 JSON 元数据，保留在项目快照里。 */
  description?: string
  metadata?: Record<string, JsonValue>
  /** Viewer 的呈现属于内容；桌面端的布局偏好另行分开。 */
  sceneDisplay?: SceneDisplay
  datasets: Dataset[]
  layers: Layer[]
  /** 支持嵌套文件夹；旧的一级分组仍然可以读取。 */
  groups: LayerGroup[]
  /**
   * 顶层的列表顺序，包含未分组的图层和分组。
   * 索引 0 是列表顶部，地图上层级最高。
   */
  rootOrder: LayerTreeEntry[]
  mapState: MapState
  /** 内容上的约束在实时的相机快照和导航更新之后依然成立。 */
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

export type ProjectContent2D = MapContent
export type ProjectContent3D = SceneContent
export type ProjectContent = ProjectContent2D | ProjectContent3D

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
