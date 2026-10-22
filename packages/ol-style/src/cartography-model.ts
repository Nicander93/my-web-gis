import { Color as StyleColor, validateStyleMin, type ExpressionSpecification, type FilterSpecification, type LayerSpecification, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { LayerStyle, Symbol, Color, LabelConfig } from './types.js'
import { symbolPrimaryColor, type LegendItem, type LegendGeometryKind } from './legend.js'
import { validateStyleAssets, type ProjectStyleAsset } from './style-assets.js'

export interface GisStyleBinding {
  gisLayerId: string
  datasetId: string
  styleSourceId: string
  styleLayerIds: string[]
}

export interface CartographyState {
  specVersion: 8
  styleLayers: LayerSpecification[]
  bindings: GisStyleBinding[]
  assets?: ProjectStyleAsset[]
}

type Geometry = 'point' | 'line' | 'polygon'
type FeatureLayerSpecification = Exclude<LayerSpecification, { type: 'background' }>
type StyleFilter = FilterSpecification
interface LegendAlias { label: string; kind: LegendGeometryKind; order: number; color: Color }
interface LegendMetadata { groupId: string; label: string; kind: LegendGeometryKind; order: number; aliases?: LegendAlias[] }
interface ClassificationMetadata {
  mode: 'categorized' | 'graduated'
  field: string
  method?: 'equal-interval' | 'quantile' | 'manual'
  value?: string | number
  fallback?: true
}
type EditorMetadata = {
  'my-web-gis:cartography'?: {
    role: 'symbol' | 'label'
    legend?: LegendMetadata
    classification?: ClassificationMetadata
    labelCoercion?: 'maplibre-to-string-json-for-arrays-objects'
  }
}

const META_KEY = 'my-web-gis:cartography'
const MAX_FINITE = Number.MAX_VALUE
const LOCAL_FONT = ['sans-serif']

function hash(value: string): string {
  let result = 0xcbf29ce484222325n
  for (let index = 0; index < value.length; index++) {
    result ^= BigInt(value.charCodeAt(index))
    result = BigInt.asUintN(64, result * 0x100000001b3n)
  }
  return result.toString(16).padStart(16, '0')
}

function sourceId(datasetId: string): string {
  return `gis-source-${hash(datasetId)}`
}

function color(value: Color | undefined): string {
  return value ? `rgba(${value.r}, ${value.g}, ${value.b}, ${value.a})` : 'rgba(0, 0, 0, 0)'
}

function finiteZoom(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.max(0, value - 1)
}

function layerBase(
  gisLayerId: string,
  datasetId: string,
  role: string,
  index: number,
  legend: LegendMetadata | undefined,
  labelConfig?: LabelConfig,
  classification?: ClassificationMetadata
): Pick<FeatureLayerSpecification, 'id' | 'source' | 'metadata' | 'minzoom' | 'maxzoom'> {
  return {
    id: `gis-${hash(gisLayerId)}-${role}-${index}`,
    source: sourceId(datasetId),
    metadata: { [META_KEY]: { role: role === 'label' ? 'label' : 'symbol', ...(legend ? { legend } : {}), ...(classification ? { classification } : {}) } },
    ...(labelConfig?.minZoom === undefined ? {} : { minzoom: finiteZoom(labelConfig.minZoom) }),
    ...(labelConfig?.maxZoom === undefined ? {} : { maxzoom: finiteZoom(labelConfig.maxZoom) })
  }
}

function geoFilter(geometry: Geometry): StyleFilter {
  const type = geometry === 'point' ? 'Point' : geometry === 'line' ? 'LineString' : 'Polygon'
  return ['==', ['geometry-type'], type] as StyleFilter
}

function withFilter(...filters: StyleFilter[]): StyleFilter {
  return filters.length === 1 ? filters[0] : ['all', ...filters] as StyleFilter
}

function typedEqual(field: string, value: string | number): StyleFilter {
  return ['all', ['==', ['typeof', ['get', field]], typeof value], ['==', ['get', field], value]] as StyleFilter
}

function anyFilter(filters: StyleFilter[]): StyleFilter {
  return ['any', ...filters] as StyleFilter
}

function setLegendAliases(layers: LayerSpecification[], startIndex: number, aliases: LegendAlias[]): void {
  for (const layer of layers.slice(startIndex)) {
    const metadata = layer.metadata as EditorMetadata | undefined
    const entry = metadata?.[META_KEY]
    if (!entry?.legend) continue
    entry.legend.aliases = aliases
  }
}

function symbolKind(symbol: Symbol): LegendGeometryKind {
  if (symbol.type === 'circle') return 'point'
  if (symbol.type === 'mixed') return symbol.polygon ? 'polygon' : symbol.line ? 'line' : 'point'
  return 'width' in symbol && !('fill' in symbol) ? 'line' : 'polygon'
}

function addSymbolLayers(
  layers: LayerSpecification[],
  symbol: Symbol,
  gisLayerId: string,
  datasetId: string,
  role: string,
  index: number,
  filter: StyleFilter | undefined,
  label: string,
  labelIndex: number,
  labelConfig?: LabelConfig,
  classification?: ClassificationMetadata
): void {
  const groupKind = symbolKind(symbol)
  const add = (layer: FeatureLayerSpecification): void => {
    if (filter) layer.filter = layer.filter ? withFilter(layer.filter, filter) : filter
    layers.push(layer)
  }
  const geometry = (kind: Geometry, part: Symbol, partIndex: number): void => {
    const id = `${role}-${index}-${kind}-${partIndex}`
    const base = layerBase(gisLayerId, datasetId, id, 0, { groupId: `${gisLayerId}:${role}:${index}`, label, kind: groupKind, order: labelIndex }, undefined, classification)
    if (kind === 'point' && part.type === 'circle') {
      add({ ...base, type: 'circle', filter: geoFilter(kind), paint: {
        'circle-radius': part.radius,
        'circle-color': color(part.fill),
        'circle-stroke-color': color(part.stroke),
        'circle-stroke-width': part.stroke ? part.strokeWidth ?? 1 : 0
      } })
      return
    }
    if (kind === 'line' && part.type === 'solid' && 'width' in part) {
      add({ ...base, type: 'line', filter: geoFilter(kind), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': color(part.color), 'line-width': part.width,
        ...(part.lineDash?.length && part.width > 0 ? { 'line-dasharray': part.lineDash.map(segment => segment / part.width) } : {})
      } })
      return
    }
    if (kind === 'polygon' && part.type === 'solid' && 'fill' in part) {
      if (part.fill) add({ ...base, type: 'fill', filter: geoFilter(kind), paint: { 'fill-color': color(part.fill), 'fill-outline-color': 'rgba(0, 0, 0, 0)' } })
      if (part.stroke) add({ ...base, id: `${base.id}-outline`, type: 'line', filter: geoFilter(kind), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': color(part.stroke), 'line-width': part.strokeWidth ?? 1,
        ...(part.lineDash?.length && (part.strokeWidth ?? 1) > 0 ? { 'line-dasharray': part.lineDash.map(segment => segment / (part.strokeWidth ?? 1)) } : {})
      } })
    }
  }

  if (symbol.type === 'mixed') {
    if (symbol.point) geometry('point', symbol.point, 0)
    if (symbol.line) geometry('line', symbol.line, 1)
    if (symbol.polygon) geometry('polygon', symbol.polygon, 2)
    return
  }
  geometry(symbol.type === 'circle' ? 'point' : 'width' in symbol ? 'line' : 'polygon', symbol, 0)
}

function addLabelLayer(
  layers: LayerSpecification[],
  label: LabelConfig | undefined,
  gisLayerId: string,
  datasetId: string,
  index: number
): void {
  if (!label) return
  const size = label.fontSize ?? 12
  const value: ExpressionSpecification = ['get', label.field]
  // Standard to-string uses JSON.stringify for arrays and objects, unlike JavaScript String().
  const textField = ['to-string', value] as ExpressionSpecification
  const layer: FeatureLayerSpecification = {
    ...layerBase(gisLayerId, datasetId, 'label', index, undefined, label),
    type: 'symbol',
    layout: {
      'text-field': textField,
      'text-font': LOCAL_FONT,
      'text-size': size,
      'text-offset': size > 0 ? [(label.offsetX ?? 0) / size, (label.offsetY ?? 0) / size] : [0, 0]
    },
    paint: {
      'text-color': color(label.color ?? { r: 0, g: 0, b: 0, a: 1 }),
      ...(label.strokeColor ? { 'text-halo-color': color(label.strokeColor), 'text-halo-width': (label.strokeWidth ?? 1) / 2 } : {})
    }
  }
  const metadata = layer.metadata as EditorMetadata
  metadata[META_KEY] = { ...metadata[META_KEY], role: 'label', labelCoercion: 'maplibre-to-string-json-for-arrays-objects' }
  layers.push(layer)
}

function classLabel(value: number, previous: number | undefined, explicit: string | undefined): string {
  return explicit ?? (previous === undefined ? `≤ ${value}` : `${previous} < x ≤ ${value}`)
}

function graduatedRange(field: string, previous: number | undefined, value: number, includeOverflow: boolean): StyleFilter {
  const property: ExpressionSpecification = ['get', field]
  if (previous === undefined) return includeOverflow ? finiteNumberFilter(field) : ['<=', property, value] as StyleFilter
  return includeOverflow
    ? ['>', property, previous] as StyleFilter
    : ['all', ['>', property, previous], ['<=', property, value]] as StyleFilter
}

function finiteNumberFilter(field: string): StyleFilter {
  const property: ExpressionSpecification = ['get', field]
  return ['all', ['==', ['typeof', property], 'number'], ['>=', property, -MAX_FINITE], ['<=', property, MAX_FINITE]] as unknown as StyleFilter
}

function jsonValueErrors(value: unknown): string[] {
  const errors: string[] = []
  const ancestors = new WeakSet<object>()
  const visit = (current: unknown, path: string, depth: number): void => {
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) errors.push(`${path} 必须是有限数值`)
      return
    }
    if (typeof current !== 'object') {
      errors.push(`${path} 不是 JSON 值`)
      return
    }
    if (depth > 100) { errors.push(`${path} 嵌套超过 100 层`); return }
    if (ancestors.has(current)) { errors.push(`${path} 存在循环引用`); return }
    const isArray = Array.isArray(current)
    const prototype = Object.getPrototypeOf(current)
    if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      errors.push(`${path} 必须是普通 JSON 对象或数组`)
      return
    }
    ancestors.add(current)
    try {
      if (isArray) {
        for (let index = 0; index < current.length; index++) visit(current[index], `${path}[${index}]`, depth + 1)
      } else {
        for (const key of Object.keys(current)) visit((current as Record<string, unknown>)[key], `${path}.${key}`, depth + 1)
      }
    } finally {
      ancestors.delete(current)
    }
  }
  try {
    visit(value, '$', 0)
  } catch (error) {
    errors.push(`$ 无法安全读取：${error instanceof Error ? error.message : String(error)}`)
  }
  return errors
}

/** Converts an existing GIS style into standard Style v8 layers and a stable binding. */
export function migrateLayerStyle(style: LayerStyle, gisLayerId: string, datasetId: string): { binding: GisStyleBinding; styleLayers: LayerSpecification[]; diagnostics: string[] } {
  if (!gisLayerId || !datasetId) throw new Error('GIS 图层 ID 和数据集 ID 不能为空')
  const layers: LayerSpecification[] = []
  const binding: GisStyleBinding = { gisLayerId, datasetId, styleSourceId: sourceId(datasetId), styleLayerIds: [] }
  const add = (symbol: Symbol, role: string, index: number, filter: StyleFilter | undefined, legend: string, legendIndex: number, classification?: ClassificationMetadata): void => {
    addSymbolLayers(layers, symbol, gisLayerId, datasetId, role, index, filter, legend, legendIndex, style.label, classification)
  }

  if (style.mode === 'single') {
    add(style.symbol, 'single', 0, undefined, '全部', 0)
  } else if (style.mode === 'categorized') {
    const categories = new Map<string | number, typeof style.categories[number]>()
    for (const category of style.categories) categories.set(category.value, category)
    const values = [...categories.values()]
    const matches = values.map(item => typedEqual(style.field, item.value))
    values.forEach((category, index) => {
      const winnerIndex = style.categories.lastIndexOf(category)
      const startIndex = layers.length
      add(category.symbol, 'category', index, typedEqual(style.field, category.value), category.label ?? String(category.value), winnerIndex,
        { mode: 'categorized', field: style.field, value: category.value })
      const aliases = style.categories.flatMap((candidate, originalIndex): LegendAlias[] => {
        if (candidate.value !== category.value || originalIndex >= winnerIndex) return []
        return [{ label: candidate.label ?? String(candidate.value), kind: symbolKind(candidate.symbol), order: originalIndex, color: symbolPrimaryColor(candidate.symbol) }]
      })
      if (aliases.length) setLegendAliases(layers, startIndex, aliases)
    })
    add(style.fallback, 'fallback', 0, matches.length ? ['!', anyFilter(matches)] as StyleFilter : undefined, '其他', style.categories.length,
      { mode: 'categorized', field: style.field, fallback: true })
  } else {
    const sortedBreaks = [...style.breaks].sort((left, right) => left.value - right.value)
    for (const item of sortedBreaks) {
      if (!Number.isFinite(item.value)) throw new Error('分级断点必须是有限数值')
    }
    const breaks = sortedBreaks.filter((item, index) => index === 0 || item.value !== sortedBreaks[index - 1]?.value)
    const finite = finiteNumberFilter(style.field)
    breaks.forEach((item, index) => {
      const previous = breaks[index - 1]?.value
      const firstIndex = sortedBreaks.findIndex(candidate => candidate.value === item.value)
      const firstAtThreshold = sortedBreaks[firstIndex]!
      const startIndex = layers.length
      add(firstAtThreshold.symbol, 'break', index, withFilter(finite, graduatedRange(style.field, previous, item.value, false)), classLabel(item.value, previous, firstAtThreshold.label), firstIndex,
        { mode: 'graduated', field: style.field, method: style.method, value: item.value })
      const aliases = sortedBreaks.flatMap((candidate, originalIndex): LegendAlias[] => {
        if (candidate.value !== item.value || originalIndex <= firstIndex) return []
        const legacyPrevious = originalIndex === 0 ? undefined : sortedBreaks[originalIndex - 1]!.value
        return [{ label: classLabel(candidate.value, legacyPrevious, candidate.label), kind: symbolKind(candidate.symbol), order: originalIndex, color: symbolPrimaryColor(candidate.symbol) }]
      })
      if (aliases.length) setLegendAliases(layers, startIndex, aliases)
    })
    if (breaks.length) {
      const highest = breaks[breaks.length - 1]!
      const duplicateHighest = sortedBreaks.filter(item => item.value === highest.value).length > 1
      if (duplicateHighest) {
        const overflow = sortedBreaks[sortedBreaks.length - 1]!
        add(overflow.symbol, 'break', breaks.length - 1,
          withFilter(finite, ['>', ['get', style.field], highest.value] as StyleFilter), classLabel(highest.value, breaks.length > 1 ? breaks[breaks.length - 2]!.value : undefined, overflow.label), breaks.length - 1,
          { mode: 'graduated', field: style.field, method: style.method, value: highest.value })
      } else {
        const last = layers[layers.length - 1] as FeatureLayerSpecification | undefined
        if (last) last.filter = withFilter(finite, graduatedRange(style.field, breaks.length > 1 ? breaks[breaks.length - 2]!.value : undefined, highest.value, true))
      }
    }
    const invalid = ['!', finite] as StyleFilter
    add(style.fallback, 'fallback', 0, breaks.length ? invalid : undefined, '其他', sortedBreaks.length,
      { mode: 'graduated', field: style.field, method: style.method, fallback: true })
  }
  addLabelLayer(layers, style.label, gisLayerId, datasetId, layers.length)
  binding.styleLayerIds = layers.map(layer => layer.id)
  const diagnostics = style.label
    ? [`label.field "${style.label.field}" 使用标准 to-string；数组/对象按 JSON 字符串化，与旧 JavaScript String(value) 不同。`]
    : []
  return { binding, styleLayers: layers, diagnostics }
}

export function createCartographyState(): CartographyState {
  return { specVersion: 8, styleLayers: [], bindings: [] }
}

/** Assembles a MapLibre Style v8 value without copying feature data into source descriptors. */
export function assembleCartographyStyle(state: CartographyState, gisLayerIdsTopFirst: readonly string[]): StyleSpecification {
  const bindings = new Map(state.bindings.map(binding => [binding.gisLayerId, binding]))
  const sources: StyleSpecification['sources'] = Object.create(null)
  const styleLayers: LayerSpecification[] = []
  for (const gisLayerId of [...gisLayerIdsTopFirst].reverse()) {
    const binding = bindings.get(gisLayerId)
    if (!binding) continue
    if (!Object.hasOwn(sources, binding.styleSourceId)) sources[binding.styleSourceId] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
    const byId = new Map(state.styleLayers.map(layer => [layer.id, layer]))
    for (const id of binding.styleLayerIds) {
      const layer = byId.get(id)
      if (layer) styleLayers.push(structuredClone(layer))
    }
  }
  return { version: 8, sources, layers: styleLayers }
}

/** Validates ownership and dangling references, then delegates Style v8 semantics to MapLibre. */
function validateCartographyStateInternal(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['$ 必须是对象']
  const jsonErrors = jsonValueErrors(value)
  if (jsonErrors.length) return jsonErrors
  const state = value as Record<string, unknown>
  const errors: string[] = []
  if (state.assets !== undefined) errors.push(...validateStyleAssets(state.assets))
  if (state.specVersion !== 8) errors.push('$.specVersion 必须为 8')
  if (!Array.isArray(state.bindings)) errors.push('$.bindings 必须是数组')
  if (!Array.isArray(state.styleLayers)) errors.push('$.styleLayers 必须是数组')
  if (errors.length) return errors

  const bindings = state.bindings as unknown[]
  const layers = state.styleLayers as unknown[]
  const layerIds = new Set<string>(), owners = new Map<string, { path: string; sourceId: string }>(), gisIds = new Set<string>()
  const sourceDatasets = new Map<string, string>()
  const datasetSources = new Map<string, string>()
  bindings.forEach((entry, index) => {
    const path = `$.bindings[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${path} 必须是对象`); return }
    const binding = entry as Record<string, unknown>
    for (const key of ['gisLayerId', 'datasetId', 'styleSourceId']) if (typeof binding[key] !== 'string' || !binding[key]) errors.push(`${path}.${key} 必须是非空字符串`)
    if (typeof binding.gisLayerId === 'string') {
      if (gisIds.has(binding.gisLayerId)) errors.push(`${path}.gisLayerId 重复：${binding.gisLayerId}`)
      gisIds.add(binding.gisLayerId)
    }
    if (typeof binding.styleSourceId === 'string' && typeof binding.datasetId === 'string') {
      const prior = sourceDatasets.get(binding.styleSourceId)
      if (prior && prior !== binding.datasetId) errors.push(`${path}.styleSourceId ${binding.styleSourceId} 对应多个 datasetId`)
      sourceDatasets.set(binding.styleSourceId, binding.datasetId)
      const datasetSource = datasetSources.get(binding.datasetId)
      if (datasetSource && datasetSource !== binding.styleSourceId) errors.push(`${path}.datasetId ${binding.datasetId} 必须共用同一个 styleSourceId`)
      datasetSources.set(binding.datasetId, binding.styleSourceId)
    }
    if (!Array.isArray(binding.styleLayerIds)) { errors.push(`${path}.styleLayerIds 必须是数组`); return }
    binding.styleLayerIds.forEach(id => {
      if (typeof id !== 'string' || !id) { errors.push(`${path}.styleLayerIds 含无效 ID`); return }
      if (owners.has(id)) errors.push(`${path}.styleLayerIds 中 ${id} 被多个 binding 引用`)
      owners.set(id, { path, sourceId: typeof binding.styleSourceId === 'string' ? binding.styleSourceId : '' })
    })
  })
  const sourceMap: StyleSpecification['sources'] = Object.create(null)
  for (const [id] of sourceDatasets) sourceMap[id] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
  const validLayers: LayerSpecification[] = []
  layers.forEach((entry, index) => {
    const path = `$.styleLayers[${index}]`
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${path} 必须是对象`); return }
    const layer = entry as Record<string, unknown>
    if (typeof layer.id !== 'string' || !layer.id) { errors.push(`${path}.id 必须是非空字符串`); return }
    if (layerIds.has(layer.id)) errors.push(`${path}.id 重复：${layer.id}`)
    layerIds.add(layer.id)
    const owner = owners.get(layer.id)
    if (!owner) errors.push(`${path}.id ${layer.id} 没有 binding`)
    if (typeof layer.source !== 'string' || !sourceDatasets.has(layer.source)) errors.push(`${path}.source 没有对应 dataset binding`)
    else if (owner && owner.sourceId !== layer.source) errors.push(`${path}.source 与 binding ${owner.path} 的 styleSourceId 不一致`)
    if ('source-layer' in layer) errors.push(`${path}.source-layer 不适用于 GeoJSON source`)
    validLayers.push(layer as unknown as LayerSpecification)
  })
  for (const id of owners.keys()) if (!layerIds.has(id)) errors.push(`$.bindings 中引用了不存在的 styleLayerId：${id}`)
  if (!errors.length) {
    const style = { version: 8, sources: sourceMap, layers: validLayers } as StyleSpecification
    try {
      for (const issue of validateStyleMin(style)) errors.push(issue.message)
    } catch (error) {
      errors.push(`$.styleLayers 无法通过标准 v8 校验：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return errors
}

/** Returns diagnostics for hostile or malformed external values instead of throwing. */
export function validateCartographyState(value: unknown): string[] {
  try {
    return validateCartographyStateInternal(value)
  } catch (error) {
    return [`$ 无法安全校验：${error instanceof Error ? error.message : String(error)}`]
  }
}

function metadataLegend(layer: LayerSpecification): LegendMetadata | undefined {
  const metadata = layer.metadata as EditorMetadata | undefined
  return metadata?.[META_KEY]?.legend
}

function literalColor(layer: LayerSpecification): { color: Color; kind: LegendGeometryKind } | undefined {
  const paint = layer.paint as Record<string, unknown> | undefined
  if (!paint) return undefined
  const candidate = layer.type === 'circle' ? paint['circle-color'] : layer.type === 'line' ? paint['line-color'] : layer.type === 'fill' ? paint['fill-color'] : undefined
  if (typeof candidate !== 'string') return undefined
  const parsed = StyleColor.parse(candidate)
  if (!parsed) return undefined
  const [r, g, b, a] = parsed.rgb
  return { color: { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255), a }, kind: layer.type === 'circle' ? 'point' : layer.type === 'line' ? 'line' : 'polygon' }
}

/** Builds literal legends; it refuses dynamic paint expressions rather than inventing swatches. */
export function buildCartographyLegendItems(layers: readonly LayerSpecification[]): LegendItem[] {
  const groups = new Map<string, { label: string; kind: LegendGeometryKind; order: number; color?: Color; colorPriority: number; dynamic: boolean; aliases: Map<string, LegendAlias> }>()
  layers.forEach((layer, index) => {
    if (!['circle', 'line', 'fill'].includes(layer.type)) return
    const legend = metadataLegend(layer)
    const key = legend?.groupId ?? layer.id
    const entry: { label: string; kind: LegendGeometryKind; order: number; color?: Color; colorPriority: number; dynamic: boolean; aliases: Map<string, LegendAlias> } = groups.get(key) ?? {
      label: legend?.label ?? layer.id,
      kind: legend?.kind ?? (layer.type === 'circle' ? 'point' : layer.type === 'line' ? 'line' : 'polygon'),
      order: legend?.order ?? index,
      colorPriority: -1,
      dynamic: false,
      aliases: new Map()
    }
    for (const alias of legend?.aliases ?? []) entry.aliases.set(`${alias.order}:${alias.label}`, alias)
    const literal = literalColor(layer)
    if (literal) {
      const priority = legend?.kind === 'polygon'
        ? layer.type === 'fill' ? 4 : 3
        : legend?.kind === 'line'
          ? layer.type === 'line' ? 3 : 1
          : layer.type === 'circle' ? 3 : 1
      if (priority >= entry.colorPriority) { entry.color = literal.color; entry.colorPriority = priority }
    }
    else entry.dynamic = true
    groups.set(key, entry)
  })
  const ordered: Array<{ order: number; item: LegendItem }> = []
  for (const [id, entry] of [...groups].sort((left, right) => left[1].order - right[1].order)) {
    if (entry.dynamic || !entry.color) throw new Error(`无法为动态或非字面符号生成常量图例：${id}`)
    ordered.push({ order: entry.order, item: { label: entry.label, kind: entry.kind, color: entry.color } })
    for (const alias of entry.aliases.values()) ordered.push({ order: alias.order, item: { label: alias.label, kind: alias.kind, color: alias.color } })
  }
  return ordered.sort((left, right) => left.order - right.order).map(entry => entry.item)
}
