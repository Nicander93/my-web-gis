import type { OgcServiceType } from './url.js'

export type { OgcServiceType }

export type WmtsRequestEncoding = 'KVP' | 'REST'

export interface ServiceLayerInfo {
  /** 机器名，对应 WMS 的 Name、WMTS 的 Identifier 或 WFS 的 name。 */
  name: string
  title?: string
  abstract?: string
  /** 嵌套的子节点，即 WMS 的图层树。 */
  children?: ServiceLayerInfo[]
  /** 图层可以请求（有 Name）时为 true。 */
  queryable?: boolean
  /** WMS 的 CRS、SRS 列表（支持继承）。WMTS 则优先看 tileMatrixSetLinks。 */
  crs?: string[]
  styles?: Array<{ name: string; title?: string; isDefault?: boolean }>
  /** Capabilities 公布时的 LatLon 或 WGS84 包围盒。 */
  bboxWgs84?: [number, number, number, number]
  /** WMTS 的格式列表，例如 image/png。 */
  formats?: string[]
  /** WMTS 的 TileMatrixSetLink 条目。 */
  tileMatrixSetLinks?: WmtsTileMatrixSetLink[]
  /** WMTS 的 ResourceURL 模板（REST），永远不含认证密钥。 */
  resourceUrls?: WmtsResourceUrl[]
  /** WFS 的 DefaultCRS 或 DefaultSRS。 */
  defaultCrs?: string
  /** WFS 的 OtherCRS 或 OtherSRS。 */
  otherCrs?: string[]
  /** 针对这个类型公布的 WFS 输出格式（较少见，优先用服务级的）。 */
  outputFormats?: string[]
}

export interface WmtsTileMatrixSetLink {
  tileMatrixSet: string
  limits?: Array<{
    tileMatrix: string
    minTileRow: number
    maxTileRow: number
    minTileCol: number
    maxTileCol: number
  }>
}

export interface WmtsResourceUrl {
  format: string
  resourceType: string
  template: string
}

/** TileMatrixSet 中的一个 TileMatrix 层级。 */
export interface WmtsTileMatrixInfo {
  identifier: string
  scaleDenominator: number
  /** Capabilities 里公布的 TopLeftCorner，坐标轴顺序以 SupportedCRS 为准。 */
  topLeftCorner: [number, number]
  tileWidth: number
  tileHeight: number
  matrixWidth?: number
  matrixHeight?: number
}

export interface TileMatrixSetInfo {
  identifier: string
  supportedCrs?: string
  tileMatrices?: WmtsTileMatrixInfo[]
}

export interface ServiceDescription {
  service: OgcServiceType
  version: string
  title?: string
  abstract?: string
  /** 这次请求使用的可分享基地址，不含密钥。 */
  shareableUrl: string
  layers: ServiceLayerInfo[]
  /** WMTS Contents 里的 TileMatrixSet 定义。 */
  tileMatrixSets?: TileMatrixSetInfo[]
  /** 从 OperationsMetadata 里取到的 KVP GetTile 地址（可分享）。 */
  wmtsGetTileUrls?: string[]
  /** 服务公布的编码方式，KVP 和 REST 可能都有。 */
  wmtsRequestEncodings?: WmtsRequestEncoding[]
  /** WFS 的要素类型名称，也会同步到 layers 里。 */
  featureTypes?: ServiceLayerInfo[]
  /** WFS GetFeature 公布的输出格式，是可分享的字符串。 */
  wfsOutputFormats?: string[]
  /** WFS GetFeature 的 KVP 端点，可分享，不含密钥。 */
  wfsGetFeatureUrls?: string[]
  /** 从 OperationsMetadata 或 Constraints 得到的 WFS 结果翻页能力。 */
  wfsPaging?: WfsPagingCapability
  rawRootLocalName?: string
}

export type ServiceAuthInput =
  | { mode: 'none' }
  | { mode: 'query-token'; param: string; token: string }
  | { mode: 'bearer'; token: string }


/** WFS GetFeature 的翻页能力是如何公布的（可能根本没有）。 */
export interface WfsPagingCapability {
  /** Capabilities 公布了 startIndex 和 count（2.0）或等价能力时为 true。 */
  supported: boolean
  /** 有 CountDefault 时，作为页大小的提示。 */
  countDefault?: number
}

export type WfsOutputFormatKind = 'geojson' | 'gml' | 'other'

export interface WfsResolvedOutputFormat {
  /** 作为 OUTPUTFORMAT 或 outputFormat 发送的值。 */
  value: string
  kind: WfsOutputFormatKind
}
