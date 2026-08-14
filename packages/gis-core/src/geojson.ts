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

export function parseGeoJsonFeatures(input: string | unknown): GisFeature[] {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input
  const featureCollection = normalizeFeatureCollection(parsed)

  return featureCollection.features
    .filter((feature) => feature.geometry)
    .map((feature) => ({
      id: String(feature.id ?? createId('feature')),
      geometry: cloneValue(feature.geometry as Geometry),
      properties: cloneValue(feature.properties ?? {})
    }))
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
