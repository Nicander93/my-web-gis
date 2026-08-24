import type { GeoJsonFeatureCollection, JsonValue } from '@desktop-webgis/scene-schema'

export interface VectorImportWarning {
  code: string
  message: string
  count?: number
}

export interface VectorImportResult {
  featureCollection: GeoJsonFeatureCollection
  warnings: VectorImportWarning[]
  sourceLayers?: string[]
}

export interface DxfImportOptions {
  curveSegments?: number
  transform?: (position: [number, number]) => [number, number]
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
