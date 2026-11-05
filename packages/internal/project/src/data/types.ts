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
    /** 类型化公开场景 ID 的宿主映射；不会写进可移植的要素元数据。 */
    sceneFeatureId?: string | number
    sceneMetadataPresent?: boolean
  }
}

/** 已声明的列在空数据集里依然存在，与当前要素的值无关。 */
export interface DatasetField {
  name: string
  type: 'string' | 'number' | 'boolean' | 'json'
  nullable: boolean
}

export type LayerStyleKind = 'point' | 'line' | 'polygon' | 'mixed'
