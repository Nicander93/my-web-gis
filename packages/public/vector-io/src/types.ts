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

export interface VectorImportWarning {
  code: string
  message: string
  count?: number
}

export interface CrsInfo {
  code?: string
  wkt?: string
  proj4?: string
}

export interface VectorImportResult {
  featureCollection: GeoJsonFeatureCollection
  warnings: VectorImportWarning[]
  sourceLayers?: string[]
  crs?: CrsInfo
  sourceCrs?: CrsInfo
}

export interface ShapefileLayerResult {
  name: string
  featureCollection: GeoJsonFeatureCollection
  crs?: CrsInfo
  sourceCrs?: CrsInfo
  hasPrj: boolean
  warnings: VectorImportWarning[]
}

export interface ShapefileImportResult {
  layers: ShapefileLayerResult[]
}

export interface DxfImportOptions {
  curveSegments?: number
  transform?: (position: [number, number]) => [number, number]
  crs?: CrsInfo
  selectedLayers?: string[]
}

export interface DxfLayerResult {
  name: string
  featureCollection: GeoJsonFeatureCollection
  warnings: VectorImportWarning[]
}

export interface DxfImportResult {
  layers: DxfLayerResult[]
  crs?: CrsInfo
}

export interface ShapefileExportOptions {
  folder?: string
  filename?: string
  prj?: string
  types?: Partial<Record<'point' | 'polygon' | 'polyline', string>>
}

export interface DxfPoint {
  x: number
  y: number
  z?: number
}

export interface DxfEntity {
  type: string
  handle?: string
  layer?: string
  vertices?: DxfPoint[]
  controlPoints?: DxfPoint[]
  position?: DxfPoint
  center?: DxfPoint
  radius?: number
  startAngle?: number
  endAngle?: number
  shape?: boolean
  flags?: number
  text?: string
  [key: string]: unknown
}

export interface DxfDocumentLike {
  entities: DxfEntity[]
  header?: Record<string, JsonValue>
}
