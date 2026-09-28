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
    sourceCrs?: string
    importId?: string
  }
}

export type DataSource =
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

export interface Dataset {
  id: string
  name: string
  kind: 'vector'
  source: DataSource
}

export type LayerStyleKind = 'point' | 'line' | 'polygon' | 'mixed'

export interface LayerStyle {
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
  style: LayerStyle
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

export interface Project {
  id: string
  version: number
  name: string
  crs: string
  datasets: Dataset[]
  layers: Layer[]
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
