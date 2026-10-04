/// <reference path="./topology.d.ts" />
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'
import STRtree from 'jsts/org/locationtech/jts/index/strtree/STRtree.js'
import type { Point, MultiPoint, LineString, MultiLineString, Polygon, MultiPolygon } from 'geojson'
export { checkGeometries } from './geometry-check.js'
export type { GeometryCheckInput, GeometryIssue, GeometryCheckReport } from './geometry-check.js'

export type AnalysisGeometry = Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon

/** A structural GeoJSON-compatible feature contract, independent of any project or map runtime. */
export interface AnalysisFeature {
  id: string
  geometry: AnalysisGeometry
  properties: Record<string, unknown>
  metadata?: { sourceId?: string | number; overlaySourceId?: string }
}

export interface NumericSummary {
  field: string
  operation: 'sum' | 'mean' | 'min' | 'max'
  output: string
}

export interface LocationSummaryOptions {
  predicate: 'intersects' | 'within'
  countField: string
  summaries?: NumericSummary[]
}

function validateOutputs(features: AnalysisFeature[], names: string[]): void {
  if (names.some(name => !name.trim()) || new Set(names).size !== names.length) throw new Error('输出字段名称必须非空且不重复。')
  const collision = names.find(name => features.some(feature => Object.hasOwn(feature.properties, name)))
  if (collision) throw new Error(`输出字段 ${collision} 已存在，请修改字段名称或前缀。`)
}

function readGeometry(feature: AnalysisFeature, reader: GeoJSONReader) {
  let west = Infinity, east = -Infinity, count = 0
  const visit = (value: unknown): void => {
    if (!Array.isArray(value) || !value.length) throw new Error(`要素 ${feature.id} 的坐标为空。`)
    if (typeof value[0] === 'number') {
      if (value.length < 2 || !value.every(Number.isFinite) || Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) throw new Error(`要素 ${feature.id} 需要有限的 WGS84 经纬度坐标。`)
      west = Math.min(west, value[0]); east = Math.max(east, value[0]); count++
    } else value.forEach(visit)
  }
  visit(feature.geometry.coordinates)
  if (!count || east - west > 180) throw new Error(`要素 ${feature.id} 跨越日期变更线，暂不支持。`)
  try {
    const geometry = reader.read(feature.geometry)
    if (!new IsValidOp(geometry).isValid()) throw new Error('几何无效，请先修复。')
    return geometry
  } catch (error) {
    throw new Error(`要素 ${feature.id}：${error instanceof Error ? error.message : '几何无效。'}`)
  }
}

function copyResult<T extends AnalysisFeature>(feature: T, extra: Record<string, unknown>): T {
  const result = structuredClone(feature)
  result.id = `feature_${crypto.randomUUID()}`
  result.properties = { ...result.properties, ...structuredClone(extra) }
  result.metadata = { ...result.metadata, sourceId: feature.id }
  return result
}

/** Count whole features once per region; overlapping regions count independently, retaining empty regions. */
export function summarizeByLocation<T extends AnalysisFeature>(regions: T[], features: AnalysisFeature[], options: LocationSummaryOptions): T[] {
  if (!['intersects', 'within'].includes(options.predicate)) throw new Error('不支持的空间关系。')
  const summaries = options.summaries ?? []
  validateOutputs(regions, [options.countField, ...summaries.map(summary => summary.output)])
  for (const summary of summaries) {
    if (!summary.field || !['sum', 'mean', 'min', 'max'].includes(summary.operation)) throw new Error('统计字段或方法无效。')
    if (features.length && !features.some(feature => Object.hasOwn(feature.properties, summary.field))) throw new Error(`统计字段 ${summary.field} 不存在。`)
  }
  const reader = new GeoJSONReader()
  const index = new STRtree<{ feature: AnalysisFeature; geometry: ReturnType<GeoJSONReader['read']> }>()
  for (const feature of features) {
    const geometry = readGeometry(feature, reader)
    index.insert(geometry.getEnvelopeInternal(), { feature, geometry })
  }
  return regions.map(region => {
    if (region.geometry.type !== 'Polygon' && region.geometry.type !== 'MultiPolygon') throw new Error(`区域 ${region.id} 不是面。`)
    const geometry = readGeometry(region, reader)
    const matches = index.query(geometry.getEnvelopeInternal()).toArray().filter(candidate => {
      const relation = RelateOp.relate(candidate.geometry, geometry)
      return options.predicate === 'within' ? relation.isWithin() : relation.isIntersects()
    })
    const extra: Record<string, unknown> = Object.assign(Object.create(null), { [options.countField]: matches.length })
    for (const summary of summaries) {
      let count = 0, sum = 0, min = Infinity, max = -Infinity
      for (const match of matches) {
        const value = match.feature.properties[summary.field]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        count++; sum += value; min = Math.min(min, value); max = Math.max(max, value)
      }
      if (!Number.isFinite(sum)) throw new Error(`区域 ${region.id} 的数值求和溢出。`)
      extra[summary.output] = summary.operation === 'sum' ? sum : !count ? null
        : summary.operation === 'mean' ? sum / count : summary.operation === 'min' ? min : max
    }
    return copyResult(region, extra)
  })
}

export interface AttributeJoinOptions {
  inputKey: string
  joinKey: string
  fields: string[]
  prefix: string
  mode: 'left' | 'inner'
}

function key(value: unknown): string | null {
  if (typeof value === 'string') return `string:${value}`
  if (typeof value === 'number' && Number.isFinite(value)) return `number:${value}`
  if (typeof value === 'boolean') return `boolean:${value}`
  return null
}

/** Typed equality join against plain records; duplicate non-null keys fail instead of silently choosing a row. */
export function joinAttributes<T extends AnalysisFeature>(features: T[], rows: Record<string, unknown>[], options: AttributeJoinOptions): T[] {
  if (!options.inputKey || !options.joinKey || !['left', 'inner'].includes(options.mode) || !options.fields.length) throw new Error('请选择连接键、连接方式及带入字段。')
  if (features.length && !features.some(feature => Object.hasOwn(feature.properties, options.inputKey))) throw new Error(`输入字段 ${options.inputKey} 不存在。`)
  for (const field of [options.joinKey, ...options.fields]) {
    if (rows.length && !rows.some(row => Object.hasOwn(row, field))) throw new Error(`连接字段 ${field} 不存在。`)
  }
  validateOutputs(features, options.fields.map(field => `${options.prefix}${field}`))
  const index = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const id = key(row[options.joinKey])
    if (id === null) continue
    if (index.has(id)) throw new Error(`连接键 ${String(row[options.joinKey])} 重复，请先去重或汇总。`)
    index.set(id, row)
  }
  return features.flatMap(feature => {
    const id = key(feature.properties[options.inputKey])
    const row = id === null ? undefined : index.get(id)
    if (!row && options.mode === 'inner') return []
    return [copyResult(feature, Object.fromEntries(options.fields.map(field => [`${options.prefix}${field}`, row && Object.hasOwn(row, field) ? row[field] : null])))]
  })
}

export interface SpatialJoinOptions {
  predicate: 'intersects' | 'within'
  fields: string[]
  prefix: string
  mode: 'left' | 'inner'
}

/** One output per matching feature pair, in input order; left joins retain unmatched features once. */
export function joinByLocation<T extends AnalysisFeature>(features: T[], joinFeatures: AnalysisFeature[], options: SpatialJoinOptions): T[] {
  if (!['intersects', 'within'].includes(options.predicate) || !['left', 'inner'].includes(options.mode) || !options.fields.length) throw new Error('请选择空间关系、连接方式及带入字段。')
  validateOutputs(features, options.fields.map(field => `${options.prefix}${field}`))
  for (const field of options.fields) {
    if (joinFeatures.length && !joinFeatures.some(feature => Object.hasOwn(feature.properties, field))) throw new Error(`连接字段 ${field} 不存在。`)
  }
  const reader = new GeoJSONReader()
  const index = new STRtree<{ feature: AnalysisFeature; geometry: ReturnType<GeoJSONReader['read']>; order: number }>()
  joinFeatures.forEach((feature, order) => {
    const geometry = readGeometry(feature, reader)
    index.insert(geometry.getEnvelopeInternal(), { feature, geometry, order })
  })
  return features.flatMap(feature => {
    const geometry = readGeometry(feature, reader)
    const matches = index.query(geometry.getEnvelopeInternal()).toArray().filter(candidate => {
      const relation = RelateOp.relate(geometry, candidate.geometry)
      return options.predicate === 'within' ? relation.isWithin() : relation.isIntersects()
    }).sort((a, b) => a.order - b.order)
    if (!matches.length && options.mode === 'inner') return []
    return (matches.length ? matches : [undefined]).map(match => {
      const result = copyResult(feature, Object.fromEntries(options.fields.map(field => [`${options.prefix}${field}`, match && Object.hasOwn(match.feature.properties, field) ? match.feature.properties[field] : null])))
      result.metadata = { ...result.metadata, overlaySourceId: match?.feature.id }
      return result
    })
  })
}
