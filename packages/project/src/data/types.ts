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

/** Declared columns survive empty datasets and are independent of current feature values. */
export interface DatasetField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'json'
  nullable: boolean
}

export type LayerStyleKind = 'point' | 'line' | 'polygon' | 'mixed'
