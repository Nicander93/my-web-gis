import type { GeoJsonFeatureCollection, JsonValue } from '@desktop-webgis/scene-schema'

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
