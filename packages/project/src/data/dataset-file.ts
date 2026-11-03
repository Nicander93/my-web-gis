import { cloneValue } from '../clone'
import { validateDatasetRows } from './dataset-schema'
import { readGeoJsonFields } from './geojson'
import type { DatasetField, GisFeature } from './types'

const MARKER = 'webgis:dataset'
const METADATA = 'webgis:metadata'
const PORTABLE_METADATA = ['sourceId', 'overlaySourceId', 'sourceCrs', 'importId'] as const

export interface ManagedDatasetContent { features: GisFeature[]; fields?: DatasetField[] }

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (typeof key !== 'string' || !allowed.includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Unsupported managed GeoJSON member')
  }
}

/** Refuse values JSON would silently omit, coerce, or invoke through a getter. */
function jsonValue(value: unknown, parents = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || parents.has(value)) throw new Error('Dataset contains a non-JSON or cyclic value')
  const array = Array.isArray(value)
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Dataset contains a non-JSON object')
  parents.add(value)
  try {
    const names = Reflect.ownKeys(value)
    if (array && (names.length !== value.length + 1 || !names.every(key => key === 'length' || typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length))) throw new Error('Dataset contains a sparse or extended array')
    for (const name of names) {
      if (array && name === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(value, name)!
      if (typeof name !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error('Dataset contains a non-JSON property')
      jsonValue(descriptor.value, parents)
    }
  } finally { parents.delete(value) }
}

function position(value: unknown): value is number[] {
  return Array.isArray(value) && value.length >= 2 && value.every(item => typeof item === 'number' && Number.isFinite(item))
}
function line(value: unknown): boolean { return Array.isArray(value) && value.length >= 2 && value.every(position) }
function ring(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 4 || !value.every(position)) return false
  const first = value[0], last = value[value.length - 1]
  return first.length === last.length && first.every((item, index) => item === last[index])
}
function polygon(value: unknown): boolean { return Array.isArray(value) && value.every(ring) }
function geometry(value: unknown): void {
  if (!object(value)) throw new Error('Invalid managed GeoJSON geometry')
  const coordinates = value.coordinates
  const valid = value.type === 'Point' ? position(coordinates)
    : value.type === 'MultiPoint' ? Array.isArray(coordinates) && coordinates.every(position)
    : value.type === 'LineString' ? line(coordinates)
    : value.type === 'MultiLineString' ? Array.isArray(coordinates) && coordinates.every(line)
    : value.type === 'Polygon' ? polygon(coordinates)
    : value.type === 'MultiPolygon' ? Array.isArray(coordinates) && coordinates.every(polygon) : false
  if (!valid) throw new Error('Invalid managed GeoJSON geometry')
}

function metadata(value: unknown, portable: boolean): GisFeature['metadata'] {
  if (!object(value)) throw new Error('Invalid managed feature metadata')
  keys(value, [...PORTABLE_METADATA, ...(portable ? [] : ['sceneFeatureId', 'sceneMetadataPresent'])])
  const result: NonNullable<GisFeature['metadata']> = {}
  for (const key of PORTABLE_METADATA) {
    const item = value[key]
    if (item === undefined && !portable) continue
    if (!Object.hasOwn(value, key)) continue
    if (key === 'sourceId' ? typeof item !== 'string' && (typeof item !== 'number' || !Number.isFinite(item)) : typeof item !== 'string') throw new Error('Invalid managed feature metadata')
    Reflect.set(result, key, item)
  }
  return result
}

/** A marker reserves this strict format; unsupported versions must not fall back to ordinary import. */
export function isManagedDatasetFile(value: unknown): boolean {
  return object(value) && Object.hasOwn(value, MARKER)
}

/** Read all rows or fail; never regenerate IDs, transform canonical coordinates, or skip invalid features. */
export function readManagedDatasetFile(input: string | unknown): ManagedDatasetContent {
  const value: unknown = typeof input === 'string' ? JSON.parse(input) : input
  jsonValue(value)
  if (!object(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) throw new Error('Invalid managed GeoJSON dataset')
  keys(value, ['type', 'features', MARKER, 'webgis:schema'])
  const marker = value[MARKER]
  if (!object(marker) || marker.version !== 1 || marker.coordinateCrs !== 'EPSG:4326') throw new Error('Unsupported managed GeoJSON dataset')
  keys(marker, ['version', 'coordinateCrs'])
  const fields = readGeoJsonFields(value), ids = new Set<string>()
  const features = value.features.map((feature): GisFeature => {
    if (!object(feature) || feature.type !== 'Feature' || typeof feature.id !== 'string' || !feature.id || ids.has(feature.id) || !object(feature.properties)) throw new Error('Invalid or duplicate managed feature')
    keys(feature, ['type', 'id', 'geometry', 'properties', METADATA]); ids.add(feature.id); geometry(feature.geometry)
    return { id: feature.id, geometry: cloneValue(feature.geometry) as GisFeature['geometry'], properties: cloneValue(feature.properties),
      ...(Object.hasOwn(feature, METADATA) ? { metadata: metadata(feature[METADATA], true) } : {}) }
  })
  validateDatasetRows(features, fields)
  return { features, ...(fields === undefined ? {} : { fields }) }
}

/** Canonical GeoJSON plus versioned schema/provenance; runtime scene mappings remain host-owned. */
export function stringifyManagedDatasetFile(features: readonly GisFeature[], fields?: DatasetField[]): string {
  if (fields !== undefined) jsonValue(fields)
  const ids = new Set<string>(), schema = fields === undefined ? undefined : readGeoJsonFields({ 'webgis:schema': { version: 1, fields } })
  validateDatasetRows(features, schema)
  const rows = features.map(feature => {
    if (!object(feature) || typeof feature.id !== 'string' || !feature.id || ids.has(feature.id) || !object(feature.properties)) throw new Error('Invalid or duplicate managed feature')
    keys(feature, ['id', 'geometry', 'properties', 'metadata']); ids.add(feature.id)
    jsonValue(feature.geometry); geometry(feature.geometry); jsonValue(feature.properties)
    return { type: 'Feature', id: feature.id, geometry: cloneValue(feature.geometry), properties: cloneValue(feature.properties),
      ...(feature.metadata === undefined ? {} : { [METADATA]: metadata(feature.metadata, false) }) }
  })
  return JSON.stringify({ type: 'FeatureCollection', [MARKER]: { version: 1, coordinateCrs: 'EPSG:4326' },
    ...(schema === undefined ? {} : { 'webgis:schema': { version: 1, fields: schema } }), features: rows }, null, 2)
}
