import { capabilitiesForDataset, cloneValue, createId, getEffectiveLocked, SetDatasetContentCommand,
  type GisFeature, type ProjectSnapshot } from '@desktop-webgis/gis-core'
import type { AnalysisGeometry } from '@desktop-webgis/spatial-analysis'
import { resolveDatasetFields, validateFieldValue } from '@/features/attribute-table/field-edits'

export type Polygon = Extract<AnalysisGeometry, { type: 'Polygon' }>
export type MultiPolygon = Extract<AnalysisGeometry, { type: 'MultiPolygon' }>
export type LineString = Extract<AnalysisGeometry, { type: 'LineString' }>
export type MultiLineString = Extract<AnalysisGeometry, { type: 'MultiLineString' }>

export type AttributePolicy = 'primary' | 'sum' | 'null-conflicts'
export type PolygonEditOptions = { mode: 'merge'; primaryId: string; policy: AttributePolicy }
  | { mode: 'split'; cutter: LineString | MultiLineString }
export interface PolygonGeometryRequest {
  mode: 'merge' | 'split'
  features: Array<{ id: string; geometry: Polygon | MultiPolygon }>
  cutter?: LineString | MultiLineString
}
export type PolygonGeometryResult = { mode: 'merge'; geometry: Polygon | MultiPolygon }
  | { mode: 'split'; parts: Record<string, Polygon[] | null> }

export function getPolygonTarget(snapshot: ProjectSnapshot, layerId: string, ids: readonly string[]) {
  const layer = snapshot.project.layers.find((item) => item.id === layerId)
  const dataset = snapshot.project.datasets.find((item) => item.id === layer?.datasetId)
  if (!layer || !dataset || !capabilitiesForDataset(dataset).editGeometry) throw new Error('请选择可写的本地矢量编辑目标')
  const locked = snapshot.project.layers.find((item) => item.datasetId === dataset.id && getEffectiveLocked(snapshot.project, item.id))
  if (locked) throw new Error(`共享数据集的图层 ${locked.name} 已锁定`)
  const features = snapshot.featuresByDataset[dataset.id] ?? []
  const lookup = new Map(features.map((feature) => [feature.id, feature]))
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('请选择面要素，且选择不能重复')
  const selected = ids.map((id) => {
    const feature = lookup.get(id)
    if (!feature) throw new Error(`要素 ${id} 已不存在，请重新选择`)
    if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') throw new Error(`要素 ${id} 不是面`)
    return { ...cloneValue(feature), geometry: cloneValue(feature.geometry) }
  })
  return { layer, dataset, features, selected }
}

function stableValue(value: unknown): string {
  const normalize = (input: unknown): unknown => input && typeof input === 'object'
    ? Array.isArray(input) ? input.map(normalize) : Object.fromEntries(Object.keys(input).sort().map((key) => [key, normalize((input as Record<string, unknown>)[key])]))
    : input ?? null
  return JSON.stringify(normalize(value))
}

function areaGeometry(geometry: Polygon | MultiPolygon): GisFeature['geometry'] {
  const ring = (positions: number[][]): [number, number][] => positions.map(([x, y]) => [x, y])
  return geometry.type === 'Polygon' ? { type: 'Polygon', coordinates: geometry.coordinates.map(ring) }
    : { type: 'MultiPolygon', coordinates: geometry.coordinates.map((polygon) => polygon.map(ring)) }
}

/** Preflight attributes and capture input data; finish builds one command after the worker succeeds. */
export function preparePolygonEdit(snapshot: ProjectSnapshot, layerId: string, ids: readonly string[], options: PolygonEditOptions) {
  const { layer, dataset, features, selected } = getPolygonTarget(snapshot, layerId, ids)
  let properties: Record<string, unknown> | undefined
  let primary: GisFeature | undefined
  if (options.mode === 'merge') {
    if (selected.length < 2) throw new Error('至少选择两个面要素')
    primary = selected.find((feature) => feature.id === options.primaryId)
    if (!primary) throw new Error('属性来源要素不在当前选择中')
    properties = cloneValue(primary.properties)
    for (const field of resolveDatasetFields(features, dataset.fields)) {
      const values = selected.map((feature) => Object.hasOwn(feature.properties, field.name) ? feature.properties[field.name] ?? null : null)
      let value: unknown = Object.hasOwn(properties, field.name) ? properties[field.name] ?? null : null
      if (options.policy === 'sum' && values.some((item) => typeof item === 'number') && values.every((item) => item == null || typeof item === 'number' && Number.isFinite(item))) {
        value = values.reduce<number>((sum, item) => sum + (typeof item === 'number' ? item : 0), 0)
      } else if (options.policy === 'null-conflicts' && values.some((item) => stableValue(item) !== stableValue(values[0]))) value = null
      validateFieldValue(field, value)
      Object.defineProperty(properties, field.name, { value: cloneValue(value), writable: true, enumerable: true, configurable: true })
    }
  }
  const input: PolygonGeometryRequest = { mode: options.mode, features: selected.map((feature) => ({
    id: feature.id, geometry: feature.geometry })), ...(options.mode === 'split' ? { cutter: cloneValue(options.cutter) } : {}) }
  return { input, datasetId: dataset.id,
    fingerprint: JSON.stringify({ dataset, features }),
    finish(result: PolygonGeometryResult) {
      const selection: string[] = []
      let after: GisFeature[]
      if (options.mode === 'merge' && result.mode === 'merge' && primary && properties) {
        const retained = primary.id
        after = features.filter((feature) => !ids.includes(feature.id) || feature.id === retained).map((feature) => feature.id === retained
          ? { ...cloneValue(feature), geometry: areaGeometry(result.geometry), properties: cloneValue(properties!) } : cloneValue(feature))
        selection.push(retained)
      } else if (options.mode === 'split' && result.mode === 'split') {
        let changed = 0
        after = features.flatMap((feature) => {
          const parts = ids.includes(feature.id) && Object.hasOwn(result.parts, feature.id) ? result.parts[feature.id] : null
          if (!parts) return [cloneValue(feature)]
          changed++
          return parts.map((geometry, index) => {
            const fragment = cloneValue(feature)
            fragment.geometry = areaGeometry(geometry)
            if (index > 0) {
              fragment.id = createId('feature')
              fragment.metadata = { ...fragment.metadata, sourceId: feature.metadata?.sourceId ?? feature.id }
              delete fragment.metadata.sceneFeatureId; delete fragment.metadata.sceneMetadataPresent
            }
            selection.push(fragment.id)
            return fragment
          })
        })
        if (!changed) throw new Error('切割线未形成新面，请让线贯穿边界或构成完整闭环')
      } else throw new Error('几何计算结果与当前操作不一致')
      const label = options.mode === 'merge' ? '合并面' : '分割面'
      return { command: new SetDatasetContentCommand(createId('cmd'), label, dataset.id,
        { fields: dataset.fields, features }, { fields: dataset.fields, features: after }), selection: { layerId: layer.id, featureIds: selection },
        message: `${label}完成：${selected.length} 个输入 → ${selection.length} 个结果；可一步撤销，图层过滤仍生效` }
    }
  }
}
