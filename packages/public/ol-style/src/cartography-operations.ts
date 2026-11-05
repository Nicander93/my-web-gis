import { createExpression, validateStyleMin, type ExpressionSpecification, type LayerSpecification, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'

export type DrawingLayerType = 'line' | 'circle' | 'fill' | 'symbol'
export type DrawingLayer = Extract<LayerSpecification, { type: DrawingLayerType }>

export interface CreateDrawingLayerOptions {
  id: string
  source: string
  type: DrawingLayerType
}

export type DrawingLayerPropertySection = 'paint' | 'layout'

export type LineWidthStop = { zoom: number; width: number }
export type LineWidthPlan =
  | { kind: 'fixed'; value: number }
  | { kind: 'field'; field: string; factor: number }
  | { kind: 'zoom-linear'; stops: readonly LineWidthStop[] }
  | { kind: 'zoom-step'; base: number; stops: readonly LineWidthStop[] }

export type ReadLineWidthResult = LineWidthPlan | { kind: 'expression'; expression: unknown }

type MutableLayer = LayerSpecification & Record<string, unknown>

/** 创建合法的标准样式层，并为在给定数据源上绘制提供合理的默认值。 */
export function createDrawingLayer(options: CreateDrawingLayerOptions): DrawingLayer {
  requireNonEmpty(options.id, '图层 ID')
  requireNonEmpty(options.source, '数据源 ID')

  const common = { id: options.id, source: options.source }
  let layer: DrawingLayer
  switch (options.type) {
    case 'line':
      layer = { ...common, type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#3388ff', 'line-width': 2 } }
      break
    case 'circle':
      layer = { ...common, type: 'circle', paint: { 'circle-color': '#3388ff', 'circle-radius': 6 } }
      break
    case 'fill':
      layer = { ...common, type: 'fill', paint: { 'fill-color': '#3388ff', 'fill-opacity': 0.35 } }
      break
    case 'symbol':
      layer = { ...common, type: 'symbol', layout: { 'text-field': ['get', 'name'], 'text-size': 12 } }
      break
    default:
      return assertNever(options.type)
  }
  validateLayer(layer)
  return layer
}

/** 设置或删除一个标准的 paint 或 layout 属性，不替换同级的 AST 或元数据。 */
export function setDrawingLayerProperty(
  layers: readonly LayerSpecification[],
  id: string,
  section: DrawingLayerPropertySection,
  name: string,
  value: unknown
): LayerSpecification[] {
  ensureUniqueLayerIds(layers)
  const index = findLayerIndex(layers, id)
  requireNonEmpty(name, '样式属性名')
  const layer = layers[index]!
  const updated = structuredClone(layer) as MutableLayer
  const properties = { ...((updated[section] as Record<string, unknown> | undefined) ?? {}) }
  if (value === undefined) delete properties[name]
  else properties[name] = structuredClone(value)
  if (Object.keys(properties).length) updated[section] = properties
  else delete updated[section]
  validateLayer(updated)
  const result = [...layers]
  result[index] = updated
  return result
}

/** 设置标准的闭区间缩放范围字段；参数省略时删除对应字段。 */
export function setDrawingLayerZoom(
  layers: readonly LayerSpecification[],
  id: string,
  minzoom?: number,
  maxzoom?: number
): LayerSpecification[] {
  ensureUniqueLayerIds(layers)
  const index = findLayerIndex(layers, id)
  if (minzoom !== undefined) requireZoom(minzoom, 'minzoom')
  if (maxzoom !== undefined) requireZoom(maxzoom, 'maxzoom')
  if (minzoom !== undefined && maxzoom !== undefined && minzoom >= maxzoom) throw new Error('minzoom 必须小于 maxzoom')

  const updated = structuredClone(layers[index]!) as MutableLayer
  if (minzoom === undefined) delete updated.minzoom
  else updated.minzoom = minzoom
  if (maxzoom === undefined) delete updated.maxzoom
  else updated.maxzoom = maxzoom
  validateLayer(updated)
  const result = [...layers]
  result[index] = updated
  return result
}

/** 把图层移动到指定位置（索引从 0 开始），稳定的 ID 保持不变。 */
export function moveDrawingLayer(layers: readonly LayerSpecification[], id: string, targetIndex: number): LayerSpecification[] {
  ensureUniqueLayerIds(layers)
  const index = findLayerIndex(layers, id)
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= layers.length) throw new Error('目标顺序超出范围')
  if (index === targetIndex) return [...layers]
  const result = [...layers]
  const [layer] = result.splice(index, 1)
  result.splice(targetIndex, 0, layer!)
  return result
}

/** 按稳定的 ID 移除一个图层。 */
export function removeDrawingLayer(layers: readonly LayerSpecification[], id: string): LayerSpecification[] {
  ensureUniqueLayerIds(layers)
  const index = findLayerIndex(layers, id)
  return layers.filter((_, candidate) => candidate !== index)
}

/** 紧跟在源图层之后复制一份，使用调用方提供的唯一 ID。 */
export function duplicateDrawingLayer(layers: readonly LayerSpecification[], id: string, newId: string): LayerSpecification[] {
  ensureUniqueLayerIds(layers)
  const index = findLayerIndex(layers, id)
  requireNonEmpty(newId, '新图层 ID')
  if (layers.some(layer => layer.id === newId)) throw new Error(`图层 ID 已存在：${newId}`)
  const duplicate = structuredClone(layers[index]!) as MutableLayer
  duplicate.id = newId
  validateLayer(duplicate)
  const result = [...layers]
  result.splice(index + 1, 0, duplicate)
  return result
}

/** 用 MapLibre 表达式语法构建一种受支持的线宽方案。 */
export function createLineWidthExpression(plan: LineWidthPlan): number | ExpressionSpecification {
  switch (plan.kind) {
    case 'fixed':
      requireFiniteNonNegative(plan.value, '固定线宽')
      return plan.value
    case 'field':
      requireNonEmpty(plan.field, '字段名')
      requireFiniteNonNegative(plan.factor, '字段倍率')
      return ['*', ['number', ['get', plan.field], 0], plan.factor]
    case 'zoom-linear':
      validateStops(plan.stops, 2)
      return ['interpolate', ['linear'], ['zoom'], ...plan.stops.flatMap(stop => [stop.zoom, stop.width])] as ExpressionSpecification
    case 'zoom-step':
      requireFiniteNonNegative(plan.base, '阶梯基础线宽')
      validateStops(plan.stops, 1)
      return ['step', ['zoom'], plan.base, ...plan.stops.flatMap(stop => [stop.zoom, stop.width])] as ExpressionSpecification
  }
}

/** 只识别受支持的线宽方案；其它合法的 MapLibre 表达式原样返回。 */
export function readLineWidthExpression(value: unknown): ReadLineWidthResult {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return { kind: 'fixed', value }
  if (!Array.isArray(value)) return { kind: 'expression', expression: value }

  const fieldPlan = readFieldWidth(value)
  if (fieldPlan) return fieldPlan
  const linearPlan = readZoomLinear(value)
  if (linearPlan) return linearPlan
  const stepPlan = readZoomStep(value)
  if (stepPlan) return stepPlan
  const parsed = createExpression(value, 'paint.line-width')
  if (parsed.result === 'error') throw new Error(`线宽表达式无效：${parsed.value.map(issue => issue.message).join('；')}`)
  return { kind: 'expression', expression: value }
}

function readFieldWidth(value: unknown[]): LineWidthPlan | undefined {
  if (value.length !== 3 || value[0] !== '*' || typeof value[2] !== 'number' || !Number.isFinite(value[2]) || value[2] < 0) return undefined
  const numeric = value[1]
  if (!Array.isArray(numeric) || numeric.length !== 3 || numeric[0] !== 'number' || numeric[2] !== 0) return undefined
  const get = numeric[1]
  if (!Array.isArray(get) || get.length !== 2 || get[0] !== 'get' || typeof get[1] !== 'string' || !get[1]) return undefined
  return { kind: 'field', field: get[1], factor: value[2] }
}

function readZoomLinear(value: unknown[]): LineWidthPlan | undefined {
  if (value.length < 7 || value[0] !== 'interpolate' || !isLinear(value[1]) || !isZoom(value[2]) || (value.length - 3) % 2 !== 0) return undefined
  const stops = readStops(value.slice(3))
  if (!stops || stops.length < 2) return undefined
  return isValidStops(stops, 2) ? { kind: 'zoom-linear', stops } : undefined
}

function readZoomStep(value: unknown[]): LineWidthPlan | undefined {
  if (value.length < 5 || value[0] !== 'step' || !isZoom(value[1]) || typeof value[2] !== 'number' || !Number.isFinite(value[2]) || value[2] < 0 || (value.length - 3) % 2 !== 0) return undefined
  const stops = readStops(value.slice(3))
  if (!stops || !isValidStops(stops, 1)) return undefined
  return { kind: 'zoom-step', base: value[2], stops }
}

function readStops(values: unknown[]): LineWidthStop[] | undefined {
  const stops: LineWidthStop[] = []
  for (let index = 0; index < values.length; index += 2) {
    const zoom = values[index]
    const width = values[index + 1]
    if (typeof zoom !== 'number' || typeof width !== 'number') return undefined
    stops.push({ zoom, width })
  }
  return stops
}

function isLinear(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'linear'
}

function isZoom(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === 'zoom'
}

function validateStops(stops: readonly LineWidthStop[], minimum: number): void {
  if (stops.length < minimum) throw new Error(`至少需要 ${minimum} 个 Zoom stop`)
  if (!isValidStops(stops, minimum)) throw new Error('Zoom stop 必须在 0..24 内严格递增，线宽必须是有限非负数')
}

function isValidStops(stops: readonly LineWidthStop[], minimum: number): boolean {
  if (stops.length < minimum) return false
  let previous = -1
  for (const stop of stops) {
    if (!Number.isFinite(stop.zoom) || stop.zoom < 0 || stop.zoom > 24 || stop.zoom <= previous || !Number.isFinite(stop.width) || stop.width < 0) return false
    previous = stop.zoom
  }
  return true
}

function validateLayer(layer: LayerSpecification): void {
  const sourceId = 'source' in layer ? layer.source : undefined
  const sources: StyleSpecification['sources'] = Object.create(null)
  if (sourceId) {
    const isVector = 'source-layer' in layer
    sources[sourceId] = isVector
      ? { type: 'vector', tiles: ['https://example.invalid/{z}/{x}/{y}.pbf'] }
      : layer.type === 'raster'
        ? { type: 'raster', tiles: ['https://example.invalid/{z}/{x}/{y}.png'], tileSize: 256 }
        : layer.type === 'hillshade' || layer.type === 'color-relief'
          ? { type: 'raster-dem', tiles: ['https://example.invalid/{z}/{x}/{y}.png'], tileSize: 256 }
          : { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
  }
  const errors = validateStyleMin({ version: 8, sources, layers: [layer] } as StyleSpecification)
  if (errors.length) throw new Error(`样式图层无效：${errors.map(error => error.message).join('；')}`)
}

function findLayerIndex(layers: readonly LayerSpecification[], id: string): number {
  requireNonEmpty(id, '图层 ID')
  const matches: number[] = []
  layers.forEach((layer, index) => { if (layer.id === id) matches.push(index) })
  if (!matches.length) throw new Error(`不存在样式图层：${id}`)
  if (matches.length > 1) throw new Error(`样式图层 ID 重复：${id}`)
  return matches[0]!
}

function ensureUniqueLayerIds(layers: readonly LayerSpecification[]): void {
  const ids = new Set<string>()
  for (const layer of layers) {
    if (ids.has(layer.id)) throw new Error(`样式图层 ID 重复：${layer.id}`)
    ids.add(layer.id)
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
}

function requireZoom(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 24) throw new Error(`${label} 必须是 0..24 内的有限数值`)
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} 必须是有限非负数`)
}

function assertNever(value: never): never {
  throw new Error(`不支持的绘制图层类型：${String(value)}`)
}
