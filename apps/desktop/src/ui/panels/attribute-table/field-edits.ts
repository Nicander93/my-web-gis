import { applyFieldFilter, cloneValue, type DatasetField, type FieldFilterCondition, type GisFeature } from '@desktop-webgis/project'
import { compileFieldExpression, type FieldValue } from '@desktop-webgis/spatial-analysis'

export type FieldCalculationScope = 'all' | 'table' | 'layer-filtered' | 'selected'

export interface FieldCalculationPreviewRow {
  index: number
  value?: FieldValue
  error?: string
}

export function validateFieldName(name: string): void {
  if (!name.trim() || name !== name.trim() || ['__proto__', 'constructor', 'prototype'].includes(name)) {
    throw new Error('字段名不能为空、包含首尾空格或使用保留名称')
  }
}

/** 计算器的显式范围要和表格展示的行集保持一致。 */
export function resolveFieldCalculationTargets(
  scope: FieldCalculationScope,
  allFeatures: readonly GisFeature[],
  tableFeatures: readonly GisFeature[],
  layerFilter: readonly FieldFilterCondition[],
  selectedIds: ReadonlySet<string>
): GisFeature[] {
  if (scope === 'all') return [...allFeatures]
  if (scope === 'table') return [...tableFeatures]
  if (scope === 'layer-filtered') return applyFieldFilter(allFeatures, [...layerFilter])
  return allFeatures.filter((feature) => selectedIds.has(feature.id))
}

/** 用生产环境的表达式引擎，评估目标数据的前五行。 */
export function previewTableField(
  allFeatures: readonly GisFeature[],
  targets: readonly GisFeature[],
  field: DatasetField,
  expression: string,
  declaredFields: readonly DatasetField[] = []
): FieldCalculationPreviewRow[] {
  validateFieldName(field.name)
  const compiled = compileFieldExpression(expression)
  const fields = resolveDatasetFields(allFeatures, declaredFields)
  for (const name of compiled.fields) {
    if (!fields.some((item) => item.name === name)) throw new Error(`表达式引用了不存在的字段 ${name}`)
  }
  return targets.slice(0, 5).map((feature, index) => {
    try {
      const value = compiled.evaluate(feature.properties)
      validateFieldValue(field, value)
      return { index: index + 1, value }
    } catch (error) {
      return { index: index + 1, error: error instanceof Error ? error.message : String(error) }
    }
  })
}

/** 旧格式导入只推断一次字段；已声明的字段类型始终优先。 */
export function resolveDatasetFields(features: readonly GisFeature[], declared: readonly DatasetField[] = []): DatasetField[] {
  const fields = cloneValue([...declared])
  const names = new Set(fields.map((field) => field.name))
  const values = new Map<string, Set<string>>()
  for (const feature of features) for (const [name, value] of Object.entries(feature.properties)) {
    if (names.has(name)) continue
    const types = values.get(name) ?? new Set<string>()
    if (value != null) types.add(typeof value)
    values.set(name, types)
  }
  for (const [name, types] of values) {
    const type = types.size === 1 ? [...types][0] : 'json'
    fields.push({ name, type: type === 'number' || type === 'boolean' || type === 'string' ? type : 'json', nullable: true })
  }
  return fields
}

export function validateFieldValue(field: DatasetField, value: unknown): void {
  if (value == null) {
    if (!field.nullable) throw new Error(`${field.name} 不允许空值`)
    return
  }
  if (field.type !== 'json' && (typeof value !== field.type ||
    (field.type === 'number' && !Number.isFinite(value)))) {
    throw new Error(`${field.name} 必须为${{ string: '文本', number: '有限数值', boolean: '布尔值' }[field.type]}`)
  }
  if (field.type === 'json') {
    // 避免 JSON 序列化时有损（NaN、Infinity、undefined 和循环引用）。
    const check = (item: unknown): void => {
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return
      if (typeof item === 'number' && Number.isFinite(item)) return
      if (typeof item !== 'object' || item === null) throw new Error(`${field.name} 必须为 JSON 值`)
      for (const nested of Object.values(item)) check(nested)
    }
    JSON.stringify(value)
    check(value)
  }
}

export function parseCellValue(field: DatasetField, draft: string): unknown {
  let value: unknown
  if (draft === '' && field.type !== 'string') value = null
  else if (field.type === 'string') value = draft
  else if (field.type === 'number') value = draft.trim() ? Number(draft) : NaN
  else if (field.type === 'boolean') {
    if (draft !== 'true' && draft !== 'false') throw new Error('布尔值请输入 true 或 false')
    value = draft === 'true'
  } else value = JSON.parse(draft)
  validateFieldValue(field, value)
  return value
}

/** 先生成一条历史命令之前，预检所有受影响的记录行。 */
export function calculateTableField(
  features: readonly GisFeature[], declared: readonly DatasetField[] | undefined,
  field: DatasetField, expression: string, targetIds: ReadonlySet<string>
): { fields: DatasetField[]; features: GisFeature[]; count: number } {
  validateFieldName(field.name)
  const fields = resolveDatasetFields(features, declared)
  const existing = fields.find((item) => item.name === field.name)
  if (existing && (existing.type !== field.type || existing.nullable !== field.nullable)) {
    throw new Error('已有字段的类型与空值约束不能通过计算器改变')
  }
  const compiled = compileFieldExpression(expression)
  for (const name of compiled.fields) {
    if (!fields.some((item) => item.name === name)) throw new Error(`表达式引用了不存在的字段 ${name}`)
  }
  if (!targetIds.size) throw new Error('当前范围没有可计算的记录')
  if ([...targetIds].some((id) => !features.some((feature) => feature.id === id))) {
    throw new Error('计算范围包含已不存在的记录，请重新选择')
  }
  let count = 0
  const next = features.map((feature) => {
    if (!targetIds.has(feature.id)) {
      if (!existing) {
        validateFieldValue(field, null)
        return { ...cloneValue(feature), properties: { ...cloneValue(feature.properties), [field.name]: null } }
      }
      return cloneValue(feature)
    }
    try {
      const value = compiled.evaluate(feature.properties)
      validateFieldValue(field, value)
      count++
      return { ...cloneValue(feature), properties: { ...cloneValue(feature.properties), [field.name]: value } }
    } catch (error) {
      throw new Error(`记录 ${feature.id}：${error instanceof Error ? error.message : String(error)}`)
    }
  })
  return { fields: existing ? fields : [...fields, cloneValue(field)], features: next, count }
}
