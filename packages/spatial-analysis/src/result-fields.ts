import type { AnalysisFeature } from './index.js'

export function validateResultField(features: readonly AnalysisFeature[], field: string): void {
  if (!field.trim() || field !== field.trim() || ['__proto__', 'constructor', 'prototype'].includes(field)) throw new Error('结果字段名称不能为空、包含首尾空格或使用保留名称。')
  if (features.some(feature => Object.hasOwn(feature.properties, field))) throw new Error(`字段 ${field} 已存在，请使用新的字段名称。`)
}

export function copyWithField<T extends AnalysisFeature>(feature: T, field: string, value: unknown): T {
  const result = structuredClone(feature)
  result.id = `feature_${crypto.randomUUID()}`
  result.properties = { ...result.properties, [field]: value }
  result.metadata = { ...result.metadata, sourceId: feature.id }
  return result
}
