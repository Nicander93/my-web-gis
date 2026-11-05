import { cloneValue } from '../clone'
import type { DatasetField, GisFeature } from './types'

export function cloneDatasetFields(fields: DatasetField[] | undefined): DatasetField[] | undefined {
  if (fields === undefined) return undefined
  if (!Array.isArray(fields) || fields.some(field => !field || typeof field.name !== 'string' || !field.name.trim() ||
    !['string', 'number', 'boolean', 'json'].includes(field.type) || typeof field.nullable !== 'boolean') ||
    new Set(fields.map(field => field.name)).size !== fields.length) throw new Error('Invalid dataset schema')
  return cloneValue(fields)
}


/** 在持久化发布之前，校验已声明的标量约束和可空性约束。 */
export function validateDatasetRows(features: Iterable<GisFeature>, fields: DatasetField[] | undefined): void {
  if (!fields) return
  for (const feature of features) for (const field of fields) {
    const value = feature.properties[field.name]
    if (value == null) {
      if (!field.nullable) throw new Error(`Field ${field.name} does not allow null values`)
    } else if (field.type !== 'json' && (typeof value !== field.type || field.type === 'number' && !Number.isFinite(value))) {
      throw new Error(`Invalid ${field.type} value for field ${field.name}`)
    }
  }
}
