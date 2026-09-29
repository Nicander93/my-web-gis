import type { OgcServiceType } from './url.js'

export type { OgcServiceType }

export type WmtsRequestEncoding = 'KVP' | 'REST'

export interface ServiceLayerInfo {
  /** Machine name (WMS Name / WMTS Identifier / WFS name). */
  name: string
  title?: string
  abstract?: string
  /** Nested children (WMS layer tree). */
  children?: ServiceLayerInfo[]
  /** True when the layer can be requested (has Name). */
  queryable?: boolean
  /** WMS CRS/SRS list (inherited). For WMTS prefer tileMatrixSetLinks. */
  crs?: string[]
  styles?: Array<{ name: string; title?: string; isDefault?: boolean }>
  /** LatLon / WGS84 bounding box when advertised. */
  bboxWgs84?: [number, number, number, number]
  /** WMTS Format list (e.g. image/png). */
  formats?: string[]
  /** WMTS TileMatrixSetLink entries. */
  tileMatrixSetLinks?: WmtsTileMatrixSetLink[]
  /** WMTS ResourceURL templates (REST). Never contain auth secrets. */
  resourceUrls?: WmtsResourceUrl[]
  /** WFS DefaultCRS / DefaultSRS. */
  defaultCrs?: string
  /** WFS OtherCRS / OtherSRS. */
  otherCrs?: string[]
  /** WFS output formats advertised for this type (rare; prefer service-level). */
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

/** One TileMatrix level from a TileMatrixSet. */
export interface WmtsTileMatrixInfo {
  identifier: string
  scaleDenominator: number
  /** TopLeftCorner as advertised in capabilities (SupportedCRS axis order). */
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
  /** Shareable base used for the request (no secrets). */
  shareableUrl: string
  layers: ServiceLayerInfo[]
  /** WMTS Contents TileMatrixSet definitions. */
  tileMatrixSets?: TileMatrixSetInfo[]
  /** KVP GetTile hrefs from OperationsMetadata (shareable). */
  wmtsGetTileUrls?: string[]
  /** Encodings advertised by the service (KVP and/or REST). */
  wmtsRequestEncodings?: WmtsRequestEncoding[]
  /** WFS feature type names (also mirrored in layers). */
  featureTypes?: ServiceLayerInfo[]
  /** WFS GetFeature advertised output formats (shareable strings). */
  wfsOutputFormats?: string[]
  /** WFS GetFeature KVP endpoint(s), shareable (no secrets). */
  wfsGetFeatureUrls?: string[]
  /** WFS result paging capability from OperationsMetadata / Constraints. */
  wfsPaging?: WfsPagingCapability
  rawRootLocalName?: string
}

export type ServiceAuthInput =
  | { mode: 'none' }
  | { mode: 'query-token'; param: string; token: string }
  | { mode: 'bearer'; token: string }


/** How WFS GetFeature pagination is advertised (if at all). */
export interface WfsPagingCapability {
  /** True when startIndex / count (2.0) or equivalent is advertised. */
  supported: boolean
  /** Page size hint from CountDefault when present. */
  countDefault?: number
}

export type WfsOutputFormatKind = 'geojson' | 'gml' | 'other'

export interface WfsResolvedOutputFormat {
  /** Value to send as OUTPUTFORMAT / outputFormat. */
  value: string
  kind: WfsOutputFormatKind
}
