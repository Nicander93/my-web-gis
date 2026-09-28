import { createId } from './id'
import { cloneValue } from './clone'
import type { GisFeature, Geometry, LayerStyleKind } from './types'

type GeoJsonGeometry = Geometry

interface GeoJsonFeature {
  type: 'Feature'
  id?: string | number
  geometry: GeoJsonGeometry | null
  properties?: Record<string, unknown> | null
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

export interface ParseGeoJsonOptions {
  importId?: string
  sourceCrs?: string
  transform?: (coords: number[]) => number[]
}

export interface ParseGeoJsonResult {
  features: GisFeature[]
  warnings: Array<{ code: string; message: string; count?: number }>
}

export function parseGeoJsonFeatures(
  input: string | unknown, 
  options: ParseGeoJsonOptions = {}
): ParseGeoJsonResult {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input
  const featureCollection = normalizeFeatureCollection(parsed)

  const features: GisFeature[] = []
  const warnings: ParseGeoJsonResult['warnings'] = []
  const idMap = new Map<string, number>()
  const importId = options.importId ?? createId('import')
  
  let emptyGeometryCount = 0
  let unsupportedGeometryCount = 0
  let invalidCoordinatesCount = 0
  let duplicateIdCount = 0

  featureCollection.features.forEach((feature, index) => {
    if (!feature.geometry) {
      emptyGeometryCount++
      return
    }
    
    const geom = feature.geometry as any
    if (geom.type === 'GeometryCollection') {
      unsupportedGeometryCount++
      return
    }
    
    if (!isValidGeometry(geom)) {
      invalidCoordinatesCount++
      return
    }
    
    let geometry = cloneValue(geom as Geometry)
    
    if (options.transform) {
      geometry = transformGeometry(geometry, options.transform)
    }
    
    const sourceId = feature.id
    let featureId: string
    
    if (sourceId !== undefined && sourceId !== null) {
      const idStr = String(sourceId)
      const count = idMap.get(idStr) ?? 0
      idMap.set(idStr, count + 1)
      
      if (count > 0) {
        duplicateIdCount++
        featureId = `${importId}-${index}`
      } else {
        featureId = idStr
      }
    } else {
      featureId = `${importId}-${index}`
    }

    features.push({
      id: featureId,
      geometry,
      properties: cloneValue(feature.properties ?? {}),
      metadata: {
        sourceId,
        sourceCrs: options.sourceCrs,
        importId
      }
    })
  })
  
  if (emptyGeometryCount > 0) {
    warnings.push({
      code: 'geojson.emptyGeometry',
      message: '跳过了空几何要素。',
      count: emptyGeometryCount
    })
  }
  
  if (unsupportedGeometryCount > 0) {
    warnings.push({
      code: 'geojson.unsupportedGeometry',
      message: '跳过了 GeometryCollection 类型(暂不支持)。',
      count: unsupportedGeometryCount
    })
  }
  
  if (invalidCoordinatesCount > 0) {
    warnings.push({
      code: 'geojson.invalidCoordinates',
      message: '跳过了包含无效坐标的要素。',
      count: invalidCoordinatesCount
    })
  }
  
  if (duplicateIdCount > 0) {
    warnings.push({
      code: 'geojson.duplicateId',
      message: '检测到重复 ID,已生成新的稳定 ID。',
      count: duplicateIdCount
    })
  }

  return { features, warnings }
}

function isValidGeometry(geometry: GeoJsonGeometry): boolean {
  const coords = extractCoordinates(geometry)
  return coords.every(coord => 
    coord.length >= 2 && 
    coord.every(n => typeof n === 'number' && Number.isFinite(n))
  )
}

function extractCoordinates(geometry: GeoJsonGeometry): number[][] {
  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates]
    case 'MultiPoint':
    case 'LineString':
      return geometry.coordinates
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates.flat()
    case 'MultiPolygon':
      return geometry.coordinates.flat(2)
    default:
      return []
  }
}

function transformGeometry(
  geometry: Geometry,
  transform: (coords: number[]) => number[]
): Geometry {
  switch (geometry.type) {
    case 'Point':
      return {
        ...geometry,
        coordinates: transform(geometry.coordinates) as [number, number] | [number, number, number]
      }
    
    case 'MultiPoint':
    case 'LineString':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map(transform) as any
      }
    
    case 'MultiLineString':
    case 'Polygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring: any) => 
          ring.map(transform)
        ) as any
      }
    
    case 'MultiPolygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon: any) =>
          polygon.map((ring: any) => ring.map(transform))
        ) as any
      }
    
    default:
      return geometry
  }
}

export function featuresToGeoJson(features: GisFeature[]): GeoJsonFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features.map((feature) => ({
      type: 'Feature',
      id: feature.id,
      geometry: cloneValue(feature.geometry),
      properties: cloneValue(feature.properties)
    }))
  }
}

export function stringifyGeoJson(features: GisFeature[]): string {
  return JSON.stringify(featuresToGeoJson(features), null, 2)
}

export function inferLayerStyleKind(features: GisFeature[]): LayerStyleKind {
  const geometryTypes = new Set(features.map((feature) => feature.geometry.type))
  if (geometryTypes.size === 0 || geometryTypes.size > 1) return 'mixed'
  const [type] = Array.from(geometryTypes)
  if (type === 'Point' || type === 'MultiPoint') return 'point'
  if (type === 'LineString' || type === 'MultiLineString') return 'line'
  if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon'
  return 'mixed'
}

function normalizeFeatureCollection(value: unknown): GeoJsonFeatureCollection {
  if (!value || typeof value !== 'object') {
    throw new Error('The file is not valid GeoJSON.')
  }

  const candidate = value as { type?: unknown; features?: unknown; geometry?: unknown; properties?: unknown }
  if (candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)) {
    return candidate as GeoJsonFeatureCollection
  }

  if (candidate.type === 'Feature' && candidate.geometry) {
    return {
      type: 'FeatureCollection',
      features: [candidate as GeoJsonFeature]
    }
  }

  if (typeof candidate.type === 'string' && 'coordinates' in candidate) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: value as GeoJsonGeometry,
          properties: {}
        }
      ]
    }
  }

  throw new Error('The file is not valid GeoJSON.')
}
