import type { CartographyState, GisStyleBinding } from '@desktop-webgis/ol-style/cartography-model'
import { cloneValue } from '../clone'
import type { DatasetField, Layer } from './types'
import type { FieldFilterCondition } from '../data/filter'
import type { FieldNameMap } from '../data/field-identities'
export type { FieldNameMap }

/** The host matches the command's two historical namespaces to the acknowledged source. */
export interface FieldReferenceRebase {
  datasetId: string
  matchingSides: readonly ('before' | 'after')[]
  layerIds: readonly string[]
  before: FieldNameMap
  after: FieldNameMap
  fields?: DatasetField[]
}

function fieldName(name: string, fields: FieldNameMap): string | undefined {
  return fields.has(name) ? fields.get(name) : name
}

export function remapFieldFilterReferences(filter: readonly FieldFilterCondition[], fields: FieldNameMap): FieldFilterCondition[] {
  return filter.flatMap(condition => {
    const name = fieldName(condition.field, fields)
    return name === undefined ? [] : [{ ...cloneValue(condition), field: name }]
  })
}

/** Remaps all operands from the original names in one pass, including colliding rename/delete pairs. */
export function remapLayerFieldReferences<T extends Pick<Layer, 'style' | 'filter' | 'interaction'>>(config: T, fields: FieldNameMap): T {
  const next = cloneValue(config)
  let style = next.style
  if ('mode' in style) {
    if (style.label) {
      const name = fieldName(style.label.field, fields)
      if (name === undefined) delete style.label
      else style.label.field = name
    }
    if (style.mode !== 'single') {
      const name = fieldName(style.field, fields)
      style = name === undefined ? { mode: 'single', symbol: style.fallback, ...(style.label ? { label: style.label } : {}) }
        : { ...style, field: name }
    }
  }
  next.style = style
  if (next.filter) next.filter = remapFieldFilterReferences(next.filter, fields)
  const popup = next.interaction?.popup
  if (popup) {
    if (popup.titleField !== undefined) {
      const name = fieldName(popup.titleField, fields)
      if (name === undefined) delete popup.titleField
      else popup.titleField = name
    }
    popup.fields = popup.fields.flatMap(item => {
      const name = fieldName(item.field, fields)
      return name === undefined ? [] : [{ ...item, field: name }]
    })
  }
  return next
}

const FILTER_OPERATORS = new Set(['==', '!=', 'in', '!in', 'has', '!has', '>', '>=', '<', '<='])

function requiredFieldName(name: string, fields: FieldNameMap): string {
  const next = fieldName(name, fields)
  if (next === undefined) throw new Error(`高级样式仍引用字段 ${name}，请先调整样式再删除字段`)
  return next
}

interface MappedExpression { value: unknown; retired?: string }

function requiredExpression(mapped: MappedExpression): unknown {
  if (mapped.retired !== undefined) throw new Error(`高级样式仍引用字段 ${mapped.retired}，请先调整样式再删除字段`)
  return mapped.value
}

function remapExpression(value: unknown, fields: FieldNameMap): MappedExpression {
  if (!Array.isArray(value) || value[0] === 'literal') return { value }
  const property = (value[0] === 'get' || value[0] === 'has') && (value.length === 2 ||
    value.length === 3 && Array.isArray(value[2]) && value[2].length === 1 && value[2][0] === 'properties')
  if (property) {
    if (typeof value[1] !== 'string') throw new Error('高级样式使用动态字段名，请先调整表达式再修改字段结构')
    const name = fieldName(value[1], fields)
    return name === undefined ? { value, retired: value[1] } : { value: [value[0], name, ...value.slice(2)] }
  }
  const children = value.map(child => remapExpression(child, fields))
  return { value: children.map(child => child.value), retired: children.find(child => child.retired !== undefined)?.retired }
}

function remapFilter(value: unknown, fields: FieldNameMap, retire: boolean): MappedExpression {
  if (!Array.isArray(value)) return { value }
  if (FILTER_OPERATORS.has(value[0]) && typeof value[1] === 'string') {
    if (['$id', '$type'].includes(value[1])) return { value }
    const name = fieldName(value[1], fields)
    return name === undefined ? { value, retired: value[1] } : { value: [value[0], name, ...value.slice(2)] }
  }
  if (['all', 'any', 'none'].includes(value[0])) {
    const children = value.slice(1).map(child => remapFilter(child, fields, retire))
    const retired = children.find(child => child.retired !== undefined)?.retired
    const retained = retire ? children.filter(child => child.retired === undefined) : children
    return { value: [value[0], ...retained.map(child => child.value)], retired: !retire || !retained.length ? retired : undefined }
  }
  return remapExpression(value, fields)
}

interface FieldStyleFragment { binding: GisStyleBinding; styleLayers: CartographyState['styleLayers'] }

function mapCartographyReferences<T extends FieldStyleFragment>(fragment: T, fields: FieldNameMap, retire: boolean): T {
  const next = cloneValue(fragment)
  const retiredStyles = new Set<string>()
  for (const style of next.styleLayers) {
    const metadata = style.metadata && typeof style.metadata === 'object' ? Reflect.get(style.metadata, 'my-web-gis:cartography') as unknown : undefined
    const classification = metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'classification') as unknown : undefined
    if (classification && typeof classification === 'object') {
      const name = Reflect.get(classification, 'field') as unknown
      if (typeof name === 'string') {
        if (retire && fieldName(name, fields) === undefined) {
          const mode = Reflect.get(classification, 'mode') as unknown
          if ((mode === 'categorized' || mode === 'graduated') && Reflect.get(classification, 'fallback') !== true) {
            retiredStyles.add(style.id); continue
          }
          Reflect.deleteProperty(metadata as object, 'classification')
        } else Reflect.set(classification, 'field', requiredFieldName(name, fields))
      }
    }
    for (const key of ['paint', 'layout', 'filter'] as const) {
      if (!(key in style)) continue
      const value = Reflect.get(style, key)
      if (key === 'filter') {
        const mapped = remapFilter(value, fields, retire)
        if (retire && mapped.retired !== undefined) Reflect.deleteProperty(style, key)
        else Reflect.set(style, key, requiredExpression(mapped))
      }
      else if (value && typeof value === 'object') {
        for (const [name, expression] of Object.entries(value)) {
          const mapped = remapExpression(expression, fields)
          if (retire && mapped.retired !== undefined) Reflect.deleteProperty(value, name)
          else Reflect.set(value, name, requiredExpression(mapped))
        }
      }
    }
  }
  if (retiredStyles.size) {
    next.styleLayers = next.styleLayers.filter(style => !retiredStyles.has(style.id))
    next.binding.styleLayerIds = next.binding.styleLayerIds.filter(id => !retiredStyles.has(id))
  }
  return next
}

/** Current schema edits reject referenced deletion; literal/display and object-local keys stay unchanged. */
export function remapCartographyFieldReferences<T extends FieldStyleFragment>(fragment: T, fields: FieldNameMap): T {
  return mapCartographyReferences(fragment, fields, false)
}

/** Historical style mementos retire dependent properties/clauses; classified layers retain only fallback. */
export function rebaseCartographyFieldReferences<T extends FieldStyleFragment>(fragment: T, fields: FieldNameMap): T {
  return fields.size ? mapCartographyReferences(fragment, fields, true) : cloneValue(fragment)
}
