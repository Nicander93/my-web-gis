import { area } from '@turf/area'
import { length } from '@turf/length'
import { checkGeometries } from './geometry-check.js'
import { copyWithField, validateResultField } from './result-fields.js'
import type { AnalysisFeature, AnalysisGeometry } from './index.js'

export type MeasurementOptions =
  | { measurement: 'area'; unit: 'square-meters' | 'hectares' | 'square-kilometers' }
  | { measurement: 'length' | 'perimeter'; unit: 'meters' | 'kilometers' }
export type MeasurementFieldOptions = MeasurementOptions & { field: string }

/** WGS84 输入按球面做 XY 测量，绝不把角度坐标当成平面米。 */
export function measureGeometry(geometry: AnalysisGeometry, options: MeasurementOptions): number {
  const isPolygon = geometry.type === 'Polygon' || geometry.type === 'MultiPolygon'
  if (!['area', 'length', 'perimeter'].includes(options.measurement)) throw new Error('不支持的测量方式。')
  if (options.measurement === 'length' ? geometry.type !== 'LineString' && geometry.type !== 'MultiLineString' : !isPolygon) throw new Error(options.measurement === 'length' ? '长度测量仅支持线。' : '面积和周长测量仅支持面。')
  const issue = checkGeometries([{ id: 'geometry', geometry }]).issues[0]
  if (issue) throw new Error(issue.message)
  let result: number
  if (options.measurement === 'area') {
    const factors = { 'square-meters': 1, hectares: 10000, 'square-kilometers': 1000000 }
    if (!Object.hasOwn(factors, options.unit)) throw new Error('面积单位无效。')
    result = area(geometry) / factors[options.unit]
  } else {
    if (options.unit !== 'meters' && options.unit !== 'kilometers') throw new Error('长度单位无效。')
    result = length({ type: 'Feature', geometry, properties: {} }, { units: options.unit })
  }
  if (!Number.isFinite(result) || result < 0) throw new Error('测量结果无效。')
  return result
}

/** 把每个源要素复制成带测量字段的独立结果；ID 冲突时整批原子失败。 */
export function addGeometryMeasurements<T extends AnalysisFeature>(features: readonly T[], options: MeasurementFieldOptions): T[] {
  validateResultField(features, options.field)
  return features.map(feature => {
    try { return copyWithField(feature, options.field, measureGeometry(feature.geometry, options)) }
    catch (error) { throw new Error(`要素 ${feature.id}：${error instanceof Error ? error.message : '测量失败'}`) }
  })
}
