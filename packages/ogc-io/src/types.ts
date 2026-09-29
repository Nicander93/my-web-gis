import type { OgcServiceType } from './url.js'

export type { OgcServiceType }

export interface ServiceLayerInfo {
  /** Machine name (WMS Name / WMTS Identifier / WFS name). */
  name: string
  title?: string
  abstract?: string
  /** Nested children (WMS layer tree). */
  children?: ServiceLayerInfo[]
  /** True when the layer can be requested (has Name). */
  queryable?: boolean
  crs?: string[]
  styles?: Array<{ name: string; title?: string }>
  /** LatLon / WGS84 bounding box when advertised. */
  bboxWgs84?: [number, number, number, number]
}

export interface TileMatrixSetInfo {
  identifier: string
  supportedCrs?: string
  tileMatrices?: Array<{ identifier: string; scaleDenominator?: number }>
}

export interface ServiceDescription {
  service: OgcServiceType
  version: string
  title?: string
  abstract?: string
  /** Shareable base used for the request (no secrets). */
  shareableUrl: string
  layers: ServiceLayerInfo[]
  /** WMTS only. */
  tileMatrixSets?: TileMatrixSetInfo[]
  /** WFS feature type names (also mirrored in layers). */
  featureTypes?: ServiceLayerInfo[]
  rawRootLocalName?: string
}

export type ServiceAuthInput =
  | { mode: 'none' }
  | { mode: 'query-token'; param: string; token: string }
  | { mode: 'bearer'; token: string }