import { cloneValue, getEffectiveLocked, type DatasetContent, type DatasetField, type GisFeature, type Layer, type Project } from '@desktop-webgis/gis-core'
import { resolveDatasetFields, validateFieldName, validateFieldValue } from './field-edits'

export type FieldSchemaEdit =
  | { type: 'add'; field: DatasetField; defaultValue: unknown }
  | { type: 'rename'; from: string; to: string }
  | { type: 'remove'; name: string; clearReferences: boolean }

const FILTER_FIELD_OPERATORS = new Set(['==', '!=', 'in', '!in', 'has', '!has', '>', '>=', '<', '<='])

function expressionReferencesField(value: unknown, name: string): boolean {
  if (Array.isArray(value)) {
    if (value[0] === 'literal') return false
    if ((value[0] === 'get' || value[0] === 'has') && value[1] === name) return true
    if (typeof value[0] === 'string' && FILTER_FIELD_OPERATORS.has(value[0]) && value[1] === name
      && name !== '$id' && name !== '$type') return true
    return value.some((child) => expressionReferencesField(child, name))
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((child) => expressionReferencesField(child, name))
  }
  return false
}

function cartographyReferencesField(project: Project, layers: readonly Layer[], name: string): boolean {
  const layerIds = new Set(layers.map((layer) => layer.id))
  const styleIds = new Set(project.cartography?.bindings
    .filter((binding) => layerIds.has(binding.gisLayerId))
    .flatMap((binding) => binding.styleLayerIds) ?? [])
  for (const style of project.cartography?.styleLayers ?? []) {
    if (!styleIds.has(style.id)) continue
    const candidate = style as unknown as Record<string, unknown>
    const metadata = candidate.metadata
    if (metadata && typeof metadata === 'object') {
      const editor = Reflect.get(metadata, 'my-web-gis:cartography')
      const classification = editor && typeof editor === 'object' ? Reflect.get(editor, 'classification') : undefined
      if (classification && typeof classification === 'object' && Reflect.get(classification, 'field') === name) return true
    }
    if (['paint', 'layout', 'filter'].some((key) => expressionReferencesField(candidate[key], name))) return true
  }
  return false
}

/** Lists legacy and standard-style references that deletion would otherwise leave dangling. */
export function getFieldReferences(project: Project, layers: readonly Layer[], name: string): string[] {
  return layers.flatMap((layer) => {
    const refs: string[] = []
    if (layer.filter?.some((condition) => condition.field === name)) refs.push('图层过滤')
    if ('mode' in layer.style) {
      if (layer.style.mode !== 'single' && layer.style.field === name) refs.push('分类/分级样式')
      if (layer.style.label?.field === name) refs.push('标注')
    }
    const popup = layer.interaction?.popup
    if (popup?.titleField === name || popup?.fields.some((field) => field.field === name)) refs.push('弹窗')
    if (cartographyReferencesField(project, [layer], name)) refs.push('高级样式表达式')
    return [...new Set(refs)].map((ref) => `${layer.name}：${ref}`)
  })
}

function remapConfig(layer: Layer, from: string, to?: string): NonNullable<DatasetContent['layers']>[number] {
  let style = cloneValue(layer.style)
  if ('mode' in style) {
    if (style.label?.field === from) {
      if (to) style.label.field = to
      else delete style.label
    }
    if (style.mode !== 'single' && style.field === from) {
      if (to) style.field = to
      else style = { mode: 'single', symbol: style.fallback, ...(style.label ? { label: style.label } : {}) }
    }
  }
  const interaction = cloneValue(layer.interaction)
  if (interaction?.popup) {
    if (interaction.popup.titleField === from) {
      if (to) interaction.popup.titleField = to
      else delete interaction.popup.titleField
    }
    interaction.popup.fields = interaction.popup.fields.flatMap((field) => field.field === from
      ? to ? [{ ...field, field: to }] : [] : [field])
  }
  return { id: layer.id, style, interaction, filter: layer.filter?.flatMap((condition) => condition.field === from
    ? to ? [{ ...condition, field: to }] : [] : [cloneValue(condition)]) }
}

/** Builds data and all shared-layer reference changes before touching history. */
export function prepareFieldSchemaEdit(project: Project, datasetId: string, features: readonly GisFeature[], edit: FieldSchemaEdit): {
  before: DatasetContent; after: DatasetContent; change: { before?: string; after?: string }
} {
  const dataset = project.datasets.find((item) => item.id === datasetId)
  if (!dataset || dataset.kind !== 'vector') throw new Error('只允许修改本地矢量数据集字段')
  const layers = project.layers.filter((layer) => layer.datasetId === datasetId)
  const locked = layers.find((layer) => getEffectiveLocked(project, layer.id))
  if (locked) throw new Error(`共享数据集的图层 ${locked.name} 已锁定，请先解除锁定`)
  const fields = resolveDatasetFields(features, dataset.fields)
  const before: DatasetContent = { fields: cloneValue(dataset.fields), features: cloneValue([...features]) }
  if (edit.type === 'add') {
    validateFieldName(edit.field.name)
    if (fields.some((field) => field.name === edit.field.name)) throw new Error(`字段 ${edit.field.name} 已存在`)
    validateFieldValue(edit.field, edit.defaultValue)
    return { before, change: { after: edit.field.name }, after: {
      fields: [...fields, cloneValue(edit.field)], features: features.map((feature) => ({ ...cloneValue(feature),
        properties: { ...cloneValue(feature.properties), [edit.field.name]: cloneValue(edit.defaultValue) } }))
    } }
  }
  const from = edit.type === 'rename' ? edit.from : edit.name
  if (!fields.some((field) => field.name === from)) throw new Error(`字段 ${from} 不存在`)
  const to = edit.type === 'rename' ? edit.to : undefined
  if (to !== undefined) {
    validateFieldName(to)
    if (to === from) throw new Error('字段名称未改变')
    if (fields.some((field) => field.name === to)) throw new Error(`字段 ${to} 已存在`)
  }
  const refs = getFieldReferences(project, layers, from)
  if (edit.type === 'remove' && refs.length && !edit.clearReferences) {
    throw new Error(`字段仍被引用：${refs.join('；')}。请勾选同时移除引用，或先调整这些配置`)
  }
  before.layers = layers.map((layer) => ({ id: layer.id, filter: cloneValue(layer.filter),
    style: cloneValue(layer.style), interaction: cloneValue(layer.interaction) }))
  return { before, change: { before: from, after: to }, after: {
    fields: fields.flatMap((field) => field.name === from ? to ? [{ ...field, name: to }] : [] : [field]),
    layers: layers.map((layer) => remapConfig(layer, from, to)),
    features: features.map((feature) => {
      const result = cloneValue(feature)
      const value = Object.hasOwn(result.properties, from) ? result.properties[from] : null
      delete result.properties[from]
      if (to) result.properties[to] = value
      return result
    })
  } }
}
