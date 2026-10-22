import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { convertFilter, validateStyleMin, type LayerSpecification, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'

export type SldCompatibilityLevel = 'supported' | 'approximated' | 'unsupported'

export interface SldCompatibilityIssue {
  path: string
  level: SldCompatibilityLevel
  reason: string
  proposedFallback?: string
}

export interface SldExportAsset {
  path: string
  mimeType: 'image/svg+xml' | 'image/png'
  contentHash: string
  attribution: { source: string; license: string }
  dataUrl: string
}

export interface SldZoomResolutionMapping {
  /** MapLibre's default 512-pixel world tile. Other tile sizes must be explicit. */
  tileSize?: number
  /** Latitude used to approximate local ground scale; defaults to the equator. */
  referenceLatitude?: number
  /** Effective world width in meters for the target CRS at the reference latitude. */
  worldWidthMeters?: number
}

export interface SldExportContext {
  targetLayerName: string
  crs: string
  zoomResolutionMapping?: SldZoomResolutionMapping
  /** Required to turn continuous zoom-dependent paint into a single preview style. */
  previewZoom?: number
  assets?: readonly SldSourceAsset[]
  strict?: boolean
  /** Actual geometry attribute in the target FeatureType; required by geometry-type filters. */
  geometryField?: string
  fieldTypes?: Readonly<Record<string, 'string' | 'number' | 'boolean'>>
}

export interface SldSourceAsset {
  id: string
  name: string
  mimeType: string
  dataUrl: string
  contentHash: string
  attribution: { source: string; license: string }
  width?: number
  height?: number
}

export interface SldExportResult {
  sldXml?: string
  assets: SldExportAsset[]
  issues: SldCompatibilityIssue[]
  level: SldCompatibilityLevel
  publishable: boolean
}

type StyleLayer = LayerSpecification
type FilterNode = { xml: string; supported: boolean; reason?: string; approximated?: string }
type Classifier = { source: unknown[]; kind: 'match'; field: string; cases: Array<{ labels: unknown[]; output: unknown }>; fallback: unknown }
  | { source: unknown[]; kind: 'step'; field: string; stops: Array<{ stop: number; output: unknown }>; fallback: unknown }
interface RulePlan {
  filter?: string
  classifierOutput?: unknown
  classKey?: string
  isFallback?: boolean
}
interface ExportState {
  issues: SldCompatibilityIssue[]
  assets: SldExportAsset[]
  context: SldExportContext
  classifiers: Map<string, Classifier>
  zoomIssuePaths: Set<string>
}

const WORLD_WIDTH_METERS = 40_075_016.68557849
const OGC_PIXEL_METERS = 0.00028
const DEFAULT_TILE_SIZE = 512
const scalar = (value: unknown): value is string | number | boolean => typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function pathPart(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1')
}

function layerPath(layer: StyleLayer): string {
  return `/layers/${pathPart(layer.id)}`
}

function addIssue(state: ExportState, path: string, level: SldCompatibilityLevel, reason: string, proposedFallback?: string): void {
  state.issues.push({ path, level, reason, ...(proposedFallback ? { proposedFallback } : {}) })
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) throw new Error('SLD 数值必须为有限数')
  return String(Number(value.toPrecision(12)))
}

function literal(value: string): string {
  return `<ogc:Literal>${xmlEscape(value)}</ogc:Literal>`
}

function propertyName(value: string): string {
  return `<ogc:PropertyName>${xmlEscape(value)}</ogc:PropertyName>`
}

function filterOperand(value: unknown): string | undefined {
  if (Array.isArray(value) && value.length === 2 && value[0] === 'get' && typeof value[1] === 'string' && value[1]) return propertyName(value[1])
  if (scalar(value)) return literal(String(value))
  return undefined
}

const comparisonTags: Record<string, string> = {
  '==': 'PropertyIsEqualTo', '!=': 'PropertyIsNotEqualTo', '<': 'PropertyIsLessThan', '<=': 'PropertyIsLessThanOrEqualTo',
  '>': 'PropertyIsGreaterThan', '>=': 'PropertyIsGreaterThanOrEqualTo'
}

function parseFilter(value: unknown, geometryField?: string, fieldTypes?: SldExportContext['fieldTypes']): FilterNode {
  if (typeof value === 'boolean') return { xml: `<ogc:PropertyIsEqualTo>${literal('1')}${literal(value ? '1' : '0')}</ogc:PropertyIsEqualTo>`, supported: true }
  if (!Array.isArray(value) || typeof value[0] !== 'string') return { xml: '', supported: false, reason: '过滤条件不是 MapLibre 标准表达式数组' }
  const operator = value[0]
  // Legacy `any` conversion protects each branch against incompatible field types.
  if (operator === 'case' && value.length === 4 && value[3] === false) return parseFilter(['all', value[1], value[2]], geometryField, fieldTypes)
  if (operator === 'all' || operator === 'any' || operator === 'none') {
    if (value.length < 2) return { xml: `<ogc:PropertyIsEqualTo>${literal('1')}${literal(operator === 'any' ? '0' : '1')}</ogc:PropertyIsEqualTo>`, supported: true }
    const children = value.slice(1).map(child => parseFilter(child, geometryField, fieldTypes))
    const unknown = children.find(child => !child.supported)
    if (unknown) return unknown
    const tag = operator === 'all' ? 'And' : 'Or'
    const condition = children.length === 1 ? children[0]!.xml : `<ogc:${tag}>${children.map(child => child.xml).join('')}</ogc:${tag}>`
    const approximated = children.find(child => child.approximated)?.approximated
    return operator === 'none'
      ? { xml: `<ogc:Not>${condition}</ogc:Not>`, supported: true, ...(approximated ? { approximated } : {}) }
      : { xml: condition, supported: true, ...(approximated ? { approximated } : {}) }
  }
  if (operator === '!' && value.length === 2) {
    const child = parseFilter(value[1], geometryField, fieldTypes)
    return child.supported ? { ...child, xml: `<ogc:Not>${child.xml}</ogc:Not>` } : child
  }
  if (operator === 'has' || operator === '!has') {
    if (value.length !== 2 || typeof value[1] !== 'string' || !value[1]) return { xml: '', supported: false, reason: `${operator} 仅支持静态字段名` }
    const test = `<ogc:PropertyIsNull>${propertyName(value[1])}</ogc:PropertyIsNull>`
    return {
      xml: operator === 'has' ? `<ogc:Not>${test}</ogc:Not>` : test,
      supported: true,
      approximated: 'SLD PropertyIsNull 无法区分缺失属性与显式 null，has 检查按非 null 属性近似'
    }
  }
  const tag = comparisonTags[operator]
  if (!tag || value.length !== 3) return { xml: '', supported: false, reason: `不支持过滤操作符 ${operator}` }
  if (Array.isArray(value[1]) && value[1][0] === 'typeof' && Array.isArray(value[1][1]) && value[1][1][0] === 'get' && ['==', '!='].includes(operator)) {
    const field = value[1][1][1]
    const type = typeof field === 'string' && fieldTypes && Object.hasOwn(fieldTypes, field) ? fieldTypes[field] : undefined
    if (!type) return { xml: '', supported: false, reason: 'typeof 字段保护需要目标字段类型，不能假定服务端会保持 JSON 混合类型' }
    const nonNull = `<ogc:Not><ogc:PropertyIsNull>${propertyName(field)}</ogc:PropertyIsNull></ogc:Not>`
    const match = type === value[2] ? nonNull : `<ogc:PropertyIsEqualTo>${literal('1')}${literal('0')}</ogc:PropertyIsEqualTo>`
    return { xml: operator === '==' ? match : `<ogc:Not>${match}</ogc:Not>`, supported: true }
  }
  if (Array.isArray(value[1]) && value[1].length === 1 && value[1][0] === 'geometry-type' && ['==', '!='].includes(operator)) {
    if (!geometryField || !['Point', 'LineString', 'Polygon'].includes(String(value[2]))) return { xml: '', supported: false, reason: 'geometry-type 过滤需要明确的目标几何字段和 Point/LineString/Polygon 类型' }
    const comparisons = [String(value[2]), `Multi${String(value[2])}`].map(type => `<ogc:PropertyIsEqualTo><ogc:Function name="geometryType">${propertyName(geometryField)}</ogc:Function>${literal(type)}</ogc:PropertyIsEqualTo>`).join('')
    const xml = `<ogc:Or>${comparisons}</ogc:Or>`
    return { supported: true, xml: operator === '==' ? xml : `<ogc:Not>${xml}</ogc:Not>` }
  }
  let left = filterOperand(value[1])
  let right = filterOperand(value[2])
  let actualTag = tag
  if (!left || !right) return { xml: '', supported: false, reason: `过滤操作 ${operator} 仅支持字段与标量值比较` }
  if (Array.isArray(value[2]) && value[2][0] === 'get') {
    ;[left, right] = [right, left]
    actualTag = ({ PropertyIsLessThan: 'PropertyIsGreaterThan', PropertyIsLessThanOrEqualTo: 'PropertyIsGreaterThanOrEqualTo', PropertyIsGreaterThan: 'PropertyIsLessThan', PropertyIsGreaterThanOrEqualTo: 'PropertyIsLessThanOrEqualTo' } as Record<string, string>)[tag] ?? tag
  }
  return { xml: `<ogc:${actualTag}>${left}${right}</ogc:${actualTag}>`, supported: true }
}

function getProperty(layer: StyleLayer, section: 'paint' | 'layout', key: string): unknown {
  const values = layer[section] as Record<string, unknown> | undefined
  return values?.[key]
}

function getClassifier(value: unknown): Classifier | undefined {
  if (!Array.isArray(value) || typeof value[0] !== 'string') return undefined
  if (value[0] === 'match' && value.length >= 5 && (value.length - 3) % 2 === 0) {
    const input = value[1]
    if (!Array.isArray(input) || input[0] !== 'get' || typeof input[1] !== 'string' || !input[1]) return undefined
    const cases: Array<{ labels: unknown[]; output: unknown }> = []
    for (let index = 2; index < value.length - 1; index += 2) {
      const rawLabels = value[index]
      const labels = Array.isArray(rawLabels) ? rawLabels : [rawLabels]
      if (!labels.length || labels.some(label => !scalar(label))) return undefined
      cases.push({ labels, output: value[index + 1] })
    }
    return { source: value, kind: 'match', field: input[1], cases, fallback: value[value.length - 1] }
  }
  if (value[0] === 'step' && value.length >= 5 && (value.length - 3) % 2 === 0) {
    const input = value[1]
    if (!Array.isArray(input) || input[0] !== 'get' || typeof input[1] !== 'string' || !input[1]) return undefined
    const stops: Array<{ stop: number; output: unknown }> = []
    for (let index = 3; index < value.length; index += 2) {
      const stop = value[index]
      if (typeof stop !== 'number' || !Number.isFinite(stop) || stops.length && stop <= stops[stops.length - 1]!.stop) return undefined
      stops.push({ stop, output: value[index + 1] })
    }
    return { source: value, kind: 'step', field: input[1], stops, fallback: value[2] }
  }
  return undefined
}

function classificationRules(classifier: Classifier): RulePlan[] {
  if (classifier.kind === 'match') {
    const values = classifier.cases.flatMap(item => item.labels)
    const classRules = classifier.cases.flatMap(item => item.labels.map(label => ({
      filter: `<ogc:PropertyIsEqualTo>${propertyName(classifier.field)}${literal(String(label))}</ogc:PropertyIsEqualTo>`,
      classifierOutput: item.output,
      classKey: JSON.stringify(label)
    })))
    if (classifier.fallback === undefined) return classRules
    const exclusion = values.map(label => `<ogc:PropertyIsEqualTo>${propertyName(classifier.field)}${literal(String(label))}</ogc:PropertyIsEqualTo>`)
    const excluded = exclusion.length === 1 ? exclusion[0] : `<ogc:Or>${exclusion.join('')}</ogc:Or>`
    return [...classRules, { filter: `<ogc:Not>${excluded}</ogc:Not>`, classifierOutput: classifier.fallback, isFallback: true }]
  }
  const rules: RulePlan[] = []
  const first = classifier.stops[0]!
  rules.push({ filter: `<ogc:PropertyIsLessThan>${propertyName(classifier.field)}${literal(numberText(first.stop))}</ogc:PropertyIsLessThan>`, classifierOutput: classifier.fallback, classKey: `step:base:${numberText(first.stop)}` })
  classifier.stops.forEach((item, index) => {
    const lower = `<ogc:PropertyIsGreaterThanOrEqualTo>${propertyName(classifier.field)}${literal(numberText(item.stop))}</ogc:PropertyIsGreaterThanOrEqualTo>`
    const next = classifier.stops[index + 1]
    const condition = next
      ? `<ogc:And>${lower}<ogc:PropertyIsLessThan>${propertyName(classifier.field)}${literal(numberText(next.stop))}</ogc:PropertyIsLessThan></ogc:And>`
      : lower
    rules.push({ filter: condition, classifierOutput: item.output, classKey: `step:${numberText(item.stop)}` })
  })
  return rules
}

function andFilters(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right
  if (!right) return left
  return `<ogc:And>${left}${right}</ogc:And>`
}

function commonClassifier(layer: StyleLayer, state: ExportState): Classifier | undefined {
  const candidates: Classifier[] = []
  for (const section of ['paint', 'layout'] as const) {
    const values = layer[section] as Record<string, unknown> | undefined
    for (const [name, value] of Object.entries(values ?? {})) {
      const classifier = getClassifier(value)
      if (classifier) candidates.push(classifier)
      else if (Array.isArray(value) && (value[0] === 'match' || value[0] === 'step')) {
        addIssue(state, `${layerPath(layer)}/${section}/${pathPart(name)}`, 'unsupported', '分类表达式的输入或断点不属于可导出的字段比较子集')
      }
    }
  }
  if (!candidates.length) return undefined
  const key = JSON.stringify(candidates[0]!.source)
  const same = candidates.every(candidate => JSON.stringify(candidate.source) === key)
  if (!same) {
    for (const classifier of candidates) addIssue(state, `${layerPath(layer)}/paint`, 'unsupported', '同一绘制层含不一致的多个分类器，无法保持规则交叉语义')
    return undefined
  }
  state.classifiers.set(layer.id, candidates[0]!)
  return candidates[0]
}

function interpolateNumber(stops: unknown[], zoom: number): number | undefined {
  if (stops.length < 4 || stops.length % 2 !== 0) return undefined
  const parsed: Array<{ zoom: number; value: number }> = []
  for (let index = 0; index < stops.length; index += 2) {
    const z = stops[index], value = stops[index + 1]
    if (typeof z !== 'number' || !Number.isFinite(z) || typeof value !== 'number' || !Number.isFinite(value) || parsed.length && z <= parsed[parsed.length - 1]!.zoom) return undefined
    parsed.push({ zoom: z, value })
  }
  if (zoom <= parsed[0]!.zoom) return parsed[0]!.value
  for (let index = 1; index < parsed.length; index++) {
    const upper = parsed[index]!, lower = parsed[index - 1]!
    if (zoom <= upper.zoom) return lower.value + (upper.value - lower.value) * ((zoom - lower.zoom) / (upper.zoom - lower.zoom))
  }
  return parsed[parsed.length - 1]!.value
}

function resolveStyleValue(value: unknown, path: string, state: ExportState, rule: RulePlan, classifier?: Classifier): unknown {
  if (classifier && Array.isArray(value) && JSON.stringify(value) === JSON.stringify(classifier.source)) return rule.classifierOutput
  if (!Array.isArray(value) || typeof value[0] !== 'string') return value
  const operator = value[0]
  if (path.endsWith('/paint/line-width') && operator === '*' && value.length === 3 && typeof value[2] === 'number' && Number.isFinite(value[2]) && Array.isArray(value[1]) && value[1].length === 3 && value[1][0] === 'number' && value[1][2] === 0 && Array.isArray(value[1][1]) && value[1][1].length === 2 && value[1][1][0] === 'get' && typeof value[1][1][1] === 'string') {
    const field = value[1][1][1]
    if (!state.context.fieldTypes || !Object.hasOwn(state.context.fieldTypes, field) || state.context.fieldTypes[field] !== 'number') {
      addIssue(state, path, 'unsupported', '字段线宽需要已确认的数值目标字段，不能静默转换字符串或对象')
      return undefined
    }
    return value
  }
  if (operator === 'interpolate' && Array.isArray(value[1]) && value[1][0] === 'linear' && Array.isArray(value[2]) && value[2][0] === 'zoom') {
    if (state.context.previewZoom === undefined) {
      addIssue(state, path, 'unsupported', '连续 Zoom 插值不能无损表示为 SLD；未提供固定预览 Zoom', '显式指定 previewZoom，按单一预览 Zoom 降级')
      return undefined
    }
    const result = interpolateNumber(value.slice(3), state.context.previewZoom)
    if (result === undefined) {
      addIssue(state, path, 'unsupported', 'Zoom 插值断点或输出值不属于可导出的数值子集')
      return undefined
    }
    if (!state.zoomIssuePaths.has(path)) {
      state.zoomIssuePaths.add(path)
      addIssue(state, path, 'approximated', `按固定 previewZoom=${state.context.previewZoom} 计算单一输出值，SLD 不包含原连续 Zoom 变化`, '调整目标预览 Zoom 或改用固定值')
    }
    return result
  }
  if (operator === 'step' && Array.isArray(value[1]) && value[1][0] === 'zoom') {
    if (state.context.previewZoom === undefined) {
      addIssue(state, path, 'unsupported', 'Zoom 阶梯不能无损表示为 SLD；未提供固定预览 Zoom', '显式指定 previewZoom，按单一预览 Zoom 降级')
      return undefined
    }
    if (value.length < 3 || (value.length - 3) % 2 !== 0) {
      addIssue(state, path, 'unsupported', 'Zoom 阶梯表达式结构无效')
      return undefined
    }
    let result = value[2]
    for (let index = 3; index < value.length; index += 2) {
      const stop = value[index]
      if (typeof stop !== 'number' || !Number.isFinite(stop) || index > 3 && stop <= Number(value[index - 2])) {
        addIssue(state, path, 'unsupported', 'Zoom 阶梯断点必须严格递增')
        return undefined
      }
      if (state.context.previewZoom >= stop) result = value[index + 1]
    }
    if (!state.zoomIssuePaths.has(path)) {
      state.zoomIssuePaths.add(path)
      addIssue(state, path, 'approximated', `按固定 previewZoom=${state.context.previewZoom} 计算单一输出值，SLD 不包含原 Zoom 阶梯`, '调整目标预览 Zoom 或改用固定值')
    }
    return result
  }
  addIssue(state, path, 'unsupported', `不支持样式表达式 ${operator}`)
  return undefined
}

function styleValue(layer: StyleLayer, section: 'paint' | 'layout', name: string, state: ExportState, rule: RulePlan, classifier?: Classifier): unknown {
  return resolveStyleValue(getProperty(layer, section, name), `${layerPath(layer)}/${section}/${pathPart(name)}`, state, rule, classifier)
}

function cssParameter(name: string, value: string | number): string {
  return `<sld:CssParameter name="${name}">${xmlEscape(String(value))}</sld:CssParameter>`
}

function cssParameterExpression(name: string, expression: string): string {
  return `<sld:CssParameter name="${name}">${expression}</sld:CssParameter>`
}

function colorAndOpacity(color: unknown, opacity: unknown, path: string, state: ExportState): { color?: string; opacity?: number } {
  if (color === undefined) return {}
  const validHex = typeof color === 'string' && /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(color)
  const validRgb = typeof color === 'string' && /^rgba?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?(?:\s*,\s*(?:\d+(?:\.\d+)?%?))?\s*\)$/i.test(color)
  if (typeof color !== 'string' || !validHex && !validRgb && color !== 'transparent') {
    addIssue(state, path, 'unsupported', '颜色需为静态 CSS 颜色字符串')
    return {}
  }
  if (color === 'transparent') return { color: '#000000', opacity: 0 }
  if (validHex) {
    const digits = color.slice(1)
    const expanded = digits.length <= 4 ? [...digits].map(value => `${value}${value}`).join('') : digits
    const hexColor = `#${expanded.slice(0, 6)}`
    const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6), 16) / 255 : 1
    return { color: hexColor, opacity: alpha * alphaMultiplier(opacity, state, path) }
  }
  const rgba = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(color)
  if (!rgba) return {}
  const rgb = `#${[rgba[1], rgba[2], rgba[3]].map(channel => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0')).join('')}`
  const embeddedAlpha = rgba[4] === undefined ? 1 : rgba[4].endsWith('%') ? Number(rgba[4].slice(0, -1)) / 100 : Number(rgba[4])
  if (!Number.isFinite(embeddedAlpha)) {
    addIssue(state, path, 'unsupported', '颜色 Alpha 分量无效')
    return {}
  }
  if (embeddedAlpha < 0 || embeddedAlpha > 1) addIssue(state, path, 'approximated', 'RGBA Alpha 已限制到 0–1 范围')
  return { color: rgb, opacity: Math.max(0, Math.min(1, embeddedAlpha)) * alphaMultiplier(opacity, state, path) }
}

function alphaMultiplier(opacity: unknown, state: ExportState, path: string): number {
  if (typeof opacity !== 'number' || !Number.isFinite(opacity)) return 1
  if (opacity < 0 || opacity > 1) addIssue(state, path, 'approximated', '不透明度已限制到 0–1 范围')
  return Math.max(0, Math.min(1, opacity))
}

function cssExpression(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return literal(numberText(value))
  if (typeof value === 'string') return literal(value)
  if (Array.isArray(value) && value.length === 3 && value[0] === '*' && typeof value[2] === 'number' && Array.isArray(value[1]) && value[1][0] === 'number' && value[1][2] === 0 && Array.isArray(value[1][1]) && value[1][1][0] === 'get' && typeof value[1][1][1] === 'string') {
    const field = propertyName(value[1][1][1])
    return `<ogc:Mul><ogc:Function name="if_then_else"><ogc:Function name="isNull">${field}</ogc:Function>${literal('0')}${field}</ogc:Function>${literal(numberText(value[2]))}</ogc:Mul>`
  }
  return undefined
}

function strokeXml(layer: StyleLayer, state: ExportState, rule: RulePlan, classifier: Classifier | undefined, prefix: 'line' | 'circle-stroke' | 'fill-outline'): string {
  const colorName = prefix === 'line' ? 'line-color' : prefix === 'circle-stroke' ? 'circle-stroke-color' : 'fill-outline-color'
  const opacityName = prefix === 'line' ? 'line-opacity' : prefix === 'circle-stroke' ? 'circle-stroke-opacity' : 'fill-opacity'
  const widthName = prefix === 'line' ? 'line-width' : prefix === 'circle-stroke' ? 'circle-stroke-width' : undefined
  const color = styleValue(layer, 'paint', colorName, state, rule, classifier) ?? (prefix === 'fill-outline' ? undefined : '#000000')
  const opacity = styleValue(layer, 'paint', opacityName, state, rule, classifier)
  const colorResult = colorAndOpacity(color, opacity, `${layerPath(layer)}/paint/${colorName}`, state)
  const params: string[] = []
  const resolvedWidth = widthName ? styleValue(layer, 'paint', widthName, state, rule, classifier) : undefined
  if (prefix === 'circle-stroke' && (resolvedWidth === undefined || resolvedWidth === 0)) return ''
  if (colorResult.color) params.push(cssParameter('stroke', colorResult.color))
  if (colorResult.opacity !== undefined && colorResult.opacity !== 1) params.push(cssParameter('stroke-opacity', numberText(colorResult.opacity)))
  if (widthName) {
    const width = resolvedWidth
    const expression = cssExpression(width)
    if (width !== undefined && expression) params.push(cssParameterExpression('stroke-width', expression))
    else if (width !== undefined) addIssue(state, `${layerPath(layer)}/paint/${widthName}`, 'unsupported', '线宽不是固定值、字段倍率或已指定预览 Zoom 的数值表达式')
  }
  if (prefix === 'line') {
    const dash = styleValue(layer, 'paint', 'line-dasharray', state, rule, classifier)
    if (dash !== undefined) {
      const width = styleValue(layer, 'paint', 'line-width', state, rule, classifier) ?? 1
      if (Array.isArray(dash) && dash.length > 0 && dash.every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) && typeof width === 'number') params.push(cssParameter('stroke-dasharray', dash.map(value => numberText(value * width)).join(' ')))
      else addIssue(state, `${layerPath(layer)}/paint/line-dasharray`, 'unsupported', '虚线仅支持正数静态断点数组')
    }
    const cap = getProperty(layer, 'layout', 'line-cap')
    if (cap !== undefined && ['butt', 'round', 'square'].includes(String(cap))) params.push(cssParameter('stroke-linecap', String(cap)))
    else if (cap !== undefined) addIssue(state, `${layerPath(layer)}/layout/line-cap`, 'unsupported', '线端点表达式或值不受支持')
    const join = getProperty(layer, 'layout', 'line-join')
    if (join !== undefined && ['bevel', 'round', 'miter'].includes(String(join))) params.push(cssParameter('stroke-linejoin', String(join)))
    else if (join !== undefined) addIssue(state, `${layerPath(layer)}/layout/line-join`, 'unsupported', '线连接表达式或值不受支持')
    const translate = getProperty(layer, 'paint', 'line-translate')
    if (translate !== undefined) {
      if (!Array.isArray(translate) || translate.some(value => value !== 0)) addIssue(state, `${layerPath(layer)}/paint/line-translate`, 'unsupported', 'SLD 1.0 不能保持线的屏幕二维平移')
    }
  }
  if (!params.length) return ''
  return `<sld:Stroke>${params.join('')}</sld:Stroke>`
}

function lineSymbolizer(layer: StyleLayer, state: ExportState, rule: RulePlan, classifier?: Classifier): string {
  const stroke = strokeXml(layer, state, rule, classifier, 'line')
  return `<sld:LineSymbolizer>${stroke || '<sld:Stroke/>'}</sld:LineSymbolizer>`
}

function polygonSymbolizer(layer: StyleLayer, state: ExportState, rule: RulePlan, classifier?: Classifier): string {
  const fill = styleValue(layer, 'paint', 'fill-color', state, rule, classifier) ?? '#000000'
  const opacity = styleValue(layer, 'paint', 'fill-opacity', state, rule, classifier)
  const resolved = colorAndOpacity(fill, opacity, `${layerPath(layer)}/paint/fill-color`, state)
  const fillXml = resolved.color ? `<sld:Fill>${cssParameter('fill', resolved.color)}${resolved.opacity !== undefined && resolved.opacity !== 1 ? cssParameter('fill-opacity', numberText(resolved.opacity)) : ''}</sld:Fill>` : ''
  const outline = strokeXml(layer, state, rule, classifier, 'fill-outline')
  const pattern = getProperty(layer, 'paint', 'fill-pattern')
  if (pattern !== undefined) {
    const asset = imageAsset(layer, state, 'paint', 'fill-pattern')
    const source = state.context.assets?.find(source => source.contentHash === asset?.contentHash)
    if (asset && source?.height) return `<sld:PolygonSymbolizer><sld:Fill><sld:GraphicFill><sld:Graphic><sld:ExternalGraphic><sld:OnlineResource xlink:type="simple" xlink:href="${xmlEscape(asset.path)}"/><sld:Format>${asset.mimeType}</sld:Format></sld:ExternalGraphic><sld:Opacity>${numberText(typeof opacity === 'number' ? opacity : 1)}</sld:Opacity><sld:Size>${numberText(source.height)}</sld:Size></sld:Graphic></sld:GraphicFill></sld:Fill></sld:PolygonSymbolizer>`
    addIssue(state, `${layerPath(layer)}/paint/fill-pattern`, 'unsupported', '面图案需要有固有尺寸的内嵌图像资源')
  }
  return `<sld:PolygonSymbolizer>${fillXml}${outline}</sld:PolygonSymbolizer>`
}

function pointSymbolizer(layer: StyleLayer, state: ExportState, rule: RulePlan, classifier?: Classifier): string {
  const color = styleValue(layer, 'paint', 'circle-color', state, rule, classifier) ?? '#000000'
  const opacity = styleValue(layer, 'paint', 'circle-opacity', state, rule, classifier)
  const result = colorAndOpacity(color, opacity, `${layerPath(layer)}/paint/circle-color`, state)
  const radius = styleValue(layer, 'paint', 'circle-radius', state, rule, classifier)
  const size = typeof radius === 'number' && Number.isFinite(radius) && radius >= 0 ? radius * 2 : radius === undefined ? 10 : undefined
  if (size === undefined) addIssue(state, `${layerPath(layer)}/paint/circle-radius`, 'unsupported', '圆点半径需是固定数值或分类输出')
  const stroke = strokeXml(layer, state, rule, classifier, 'circle-stroke')
  return `<sld:PointSymbolizer><sld:Graphic><sld:Mark><sld:WellKnownName>circle</sld:WellKnownName>${result.color ? `<sld:Fill>${cssParameter('fill', result.color)}${result.opacity !== undefined && result.opacity !== 1 ? cssParameter('fill-opacity', numberText(result.opacity)) : ''}</sld:Fill>` : ''}${stroke}</sld:Mark>${size === undefined ? '' : `<sld:Size>${numberText(size)}</sld:Size>`}</sld:Graphic></sld:PointSymbolizer>`
}

function textAnchor(value: unknown): { x: number; y: number } | undefined {
  const positions: Record<string, { x: number; y: number }> = {
    center: { x: 0.5, y: 0.5 }, left: { x: 0, y: 0.5 }, right: { x: 1, y: 0.5 }, top: { x: 0.5, y: 1 }, bottom: { x: 0.5, y: 0 },
    'top-left': { x: 0, y: 1 }, 'top-right': { x: 1, y: 1 }, 'bottom-left': { x: 0, y: 0 }, 'bottom-right': { x: 1, y: 0 }
  }
  return typeof value === 'string' ? positions[value] : undefined
}

function textSymbolizer(layer: StyleLayer, state: ExportState, rule: RulePlan, classifier?: Classifier): string {
  const rawTextField = getProperty(layer, 'layout', 'text-field')
  const textField = classifier && Array.isArray(rawTextField) && JSON.stringify(rawTextField) === JSON.stringify(classifier.source)
    ? rule.classifierOutput
    : rawTextField
  let label: string | undefined
  if (typeof textField === 'string') label = literal(textField)
  else if (Array.isArray(textField) && textField.length === 2 && textField[0] === 'get' && typeof textField[1] === 'string') label = propertyName(textField[1])
  else if (Array.isArray(textField) && textField.length === 2 && textField[0] === 'to-string' && Array.isArray(textField[1]) && textField[1][0] === 'get' && typeof textField[1][1] === 'string') {
    label = propertyName(textField[1][1])
    addIssue(state, `${layerPath(layer)}/layout/text-field`, 'approximated', '字段文字按 GeoServer 的标量格式输出；数值格式、数组和对象不保证与 MapLibre to-string 相同')
  }
  else if (textField !== undefined) addIssue(state, `${layerPath(layer)}/layout/text-field`, 'unsupported', '文字内容仅支持固定文本或直接字段引用')
  if (!label) return ''

  const fontParams: string[] = []
  const fillParams: string[] = []
  const color = styleValue(layer, 'paint', 'text-color', state, rule, classifier)
  const opacity = styleValue(layer, 'paint', 'text-opacity', state, rule, classifier)
  const textColor = colorAndOpacity(color, opacity, `${layerPath(layer)}/paint/text-color`, state)
  if (textColor.color) fillParams.push(cssParameter('fill', textColor.color))
  if (textColor.opacity !== undefined && textColor.opacity !== 1) fillParams.push(cssParameter('fill-opacity', numberText(textColor.opacity)))

  const haloColor = styleValue(layer, 'paint', 'text-halo-color', state, rule, classifier)
  const haloWidth = styleValue(layer, 'paint', 'text-halo-width', state, rule, classifier)
  let haloXml = ''
  if (haloWidth !== undefined || haloColor !== undefined) {
    const halo = colorAndOpacity(haloColor, 1, `${layerPath(layer)}/paint/text-halo-color`, state)
    const radius = typeof haloWidth === 'number' && Number.isFinite(haloWidth) ? numberText(haloWidth) : '0'
    haloXml = `<sld:Halo><sld:Radius>${radius}</sld:Radius>${halo.color ? `<sld:Fill>${cssParameter('fill', halo.color)}${halo.opacity !== undefined && halo.opacity !== 1 ? cssParameter('fill-opacity', halo.opacity) : ''}</sld:Fill>` : ''}</sld:Halo>`
  }

  const font = getProperty(layer, 'layout', 'text-font')
  const fontStack = Array.isArray(font) && font.every(name => typeof name === 'string') ? font as string[] : undefined
  if (font !== undefined && !fontStack) addIssue(state, `${layerPath(layer)}/layout/text-font`, 'unsupported', '字体仅支持静态字体栈')
  const size = styleValue(layer, 'layout', 'text-size', state, rule, classifier)
  if (typeof size === 'number' && Number.isFinite(size)) fontParams.push(cssParameter('font-size', numberText(size)))
  else if (size !== undefined) addIssue(state, `${layerPath(layer)}/layout/text-size`, 'unsupported', '文字大小需为固定数值或分类输出')
  if (fontStack?.length) {
    fontParams.push(cssParameter('font-family', fontStack[0]!))
    if (fontStack.length > 1) addIssue(state, `${layerPath(layer)}/layout/text-font`, 'approximated', 'SLD 字体配置只采用字体栈中的首选字体')
  }

  const anchorValue = getProperty(layer, 'layout', 'text-anchor')
  const anchor = anchorValue === undefined ? { x: 0.5, y: 0.5 } : textAnchor(anchorValue)
  if (!anchor && anchorValue !== undefined) addIssue(state, `${layerPath(layer)}/layout/text-anchor`, 'unsupported', '文字锚点不是静态标准锚点')
  const offset = getProperty(layer, 'layout', 'text-offset')
  const textSize = typeof size === 'number' ? size : 12
  const displacement = Array.isArray(offset) && offset.length === 2 && offset.every(value => typeof value === 'number' && Number.isFinite(value))
    ? `<sld:Displacement><sld:DisplacementX>${numberText(offset[0] * textSize)}</sld:DisplacementX><sld:DisplacementY>${numberText(-offset[1] * textSize)}</sld:DisplacementY></sld:Displacement>`
    : offset === undefined ? '' : (addIssue(state, `${layerPath(layer)}/layout/text-offset`, 'unsupported', '文字偏移需是静态二元数值数组'), '')
  if (Array.isArray(offset)) addIssue(state, `${layerPath(layer)}/layout/text-offset`, 'approximated', 'MapLibre em 偏移按文字字号换算为 SLD 像素位移')
  const rotation = getProperty(layer, 'layout', 'text-rotate')
  if (rotation !== undefined && typeof rotation !== 'number') addIssue(state, `${layerPath(layer)}/layout/text-rotate`, 'unsupported', '文字旋转只支持静态角度')
  const placement = getProperty(layer, 'layout', 'symbol-placement')
  let pointPlacement = ''
  let linePlacement = ''
  if (placement === 'line' || placement === 'line-center') {
    const gap = getProperty(layer, 'layout', 'symbol-spacing')
    if (typeof gap === 'number' && Number.isFinite(gap) && gap > 0) {
      linePlacement = '<sld:LinePlacement/>'
      addIssue(state, `${layerPath(layer)}/layout/symbol-spacing`, 'unsupported', 'SLD 1.0 LinePlacement 不包含重复间距；需服务端专项降级')
    }
    else {
      linePlacement = '<sld:LinePlacement/>'
      if (gap !== undefined) addIssue(state, `${layerPath(layer)}/layout/symbol-spacing`, 'unsupported', '沿线间距必须是正数固定值')
    }
    if (placement === 'line-center') addIssue(state, `${layerPath(layer)}/layout/symbol-placement`, 'approximated', 'line-center 近似为 SLD 沿线文字放置')
    if (offset !== undefined || rotation !== undefined) addIssue(state, `${layerPath(layer)}/layout/text-offset`, 'unsupported', 'SLD 1.0 沿线放置不支持保留 MapLibre 文本偏移或旋转')
  } else if (placement === undefined || placement === 'point') {
    pointPlacement = `<sld:PointPlacement>${anchor ? `<sld:AnchorPoint><sld:AnchorPointX>${anchor.x}</sld:AnchorPointX><sld:AnchorPointY>${anchor.y}</sld:AnchorPointY></sld:AnchorPoint>` : ''}${displacement}${typeof rotation === 'number' ? `<sld:Rotation>${numberText(rotation)}</sld:Rotation>` : ''}</sld:PointPlacement>`
  } else addIssue(state, `${layerPath(layer)}/layout/symbol-placement`, 'unsupported', '文字放置方式不是静态 point/line/line-center')

  if (getProperty(layer, 'layout', 'text-keep-upright') !== undefined) addIssue(state, `${layerPath(layer)}/layout/text-keep-upright`, 'unsupported', '保持文字正向属于渲染器行为，SLD 1.0 无对应标准属性')
  for (const name of ['text-padding', 'text-max-angle', 'text-allow-overlap', 'text-ignore-placement', 'text-optional', 'icon-optional', 'symbol-avoid-edges']) {
    if (getProperty(layer, 'layout', name) !== undefined) addIssue(state, `${layerPath(layer)}/layout/${name}`, 'unsupported', '该避让/碰撞选项没有可保持语义的 SLD 1.0 标准映射')
  }
  const labelPlacement = `<sld:LabelPlacement>${pointPlacement}${linePlacement}</sld:LabelPlacement>`
  const fillXml = fillParams.length ? `<sld:Fill>${fillParams.join('')}</sld:Fill>` : ''
  const fontXml = fontParams.length ? `<sld:Font>${fontParams.join('')}</sld:Font>` : ''
  return `<sld:TextSymbolizer><sld:Label>${label}</sld:Label>${fontXml}${labelPlacement}${haloXml}${fillXml}</sld:TextSymbolizer>`
}
function imageAsset(layer: StyleLayer, state: ExportState, section: 'paint' | 'layout' = 'layout', name = 'icon-image'): SldExportAsset | undefined {
  const icon = getProperty(layer, section, name)
  if (icon === undefined) return undefined
  const path = `${layerPath(layer)}/${section}/${name}`
  if (typeof icon !== 'string') {
    addIssue(state, path, 'unsupported', '圖標名稱不是固定字符串')
    return undefined
  }
  const source = state.context.assets?.find(asset => asset.id === icon || asset.name === icon)
  if (!source) {
    addIssue(state, path, 'unsupported', '圖標資源未匹配到已內嵌資產；不會輸出臨時或公網 URL', '将已审核资源加入 style assets 并引用其 ID')
    return undefined
  }
  if (source.mimeType !== 'image/svg+xml' && source.mimeType !== 'image/png') {
    addIssue(state, path, 'unsupported', `資源 MIME ${source.mimeType} 不是可导出的 SVG/PNG`)
    return undefined
  }
  if (!source.dataUrl.startsWith(`data:${source.mimeType};base64,`) || !/^[\da-f]{64}$/i.test(source.contentHash)) {
    addIssue(state, path, 'unsupported', '資源缺少原始内嵌 base64 数据或 SHA-256 内容哈希')
    return undefined
  }
  const extension = source.mimeType === 'image/svg+xml' ? 'svg' : 'png'
  const asset: SldExportAsset = {
    path: `${source.contentHash}.${extension}`,
    mimeType: source.mimeType,
    contentHash: source.contentHash,
    attribution: source.attribution,
    dataUrl: source.dataUrl
  }
  if (!state.assets.some(existing => existing.contentHash === asset.contentHash)) state.assets.push(asset)
  return asset
}

function iconSymbolizer(layer: StyleLayer, state: ExportState): string {
  const asset = imageAsset(layer, state)
  if (!asset) return ''
  const size = getProperty(layer, 'layout', 'icon-size')
  const source = state.context.assets?.find(source => source.contentHash === asset.contentHash)
  const intrinsicHeight = source?.height
  if (!intrinsicHeight || !Number.isFinite(intrinsicHeight)) addIssue(state, `${layerPath(layer)}/layout/icon-size`, 'unsupported', '图标需要资源固有尺寸，不能把比例误写为像素尺寸')
  if (size !== undefined && typeof size !== 'number') addIssue(state, `${layerPath(layer)}/layout/icon-size`, 'unsupported', '圖標大小只支持固定值')
  const rotation = getProperty(layer, 'layout', 'icon-rotate')
  if (rotation !== undefined && typeof rotation !== 'number') addIssue(state, `${layerPath(layer)}/layout/icon-rotate`, 'unsupported', '圖標旋轉只支持固定角度')
  const mime = asset.mimeType
  return `<sld:PointSymbolizer><sld:Graphic><sld:ExternalGraphic><sld:OnlineResource xlink:type="simple" xlink:href="${xmlEscape(asset.path)}"/><sld:Format>${mime}</sld:Format></sld:ExternalGraphic>${intrinsicHeight ? `<sld:Size>${numberText(intrinsicHeight * (typeof size === 'number' ? size : 1))}</sld:Size>` : ''}${typeof rotation === 'number' ? `<sld:Rotation>${numberText(rotation)}</sld:Rotation>` : ''}</sld:Graphic></sld:PointSymbolizer>`
}

function symbolizerXml(layer: StyleLayer, state: ExportState, rule: RulePlan, classifier?: Classifier): string {
  switch (layer.type) {
    case 'line': return lineSymbolizer(layer, state, rule, classifier)
    case 'fill': return polygonSymbolizer(layer, state, rule, classifier)
    case 'circle': return pointSymbolizer(layer, state, rule, classifier)
    case 'symbol': return `${iconSymbolizer(layer, state)}${textSymbolizer(layer, state, rule, classifier)}`
    case 'background': return ''
    case 'raster': case 'heatmap': case 'hillshade': case 'fill-extrusion': case 'color-relief':
      addIssue(state, layerPath(layer), 'unsupported', `${layer.type} 层不属于本阶段的矢量 SLD 符号化子集`)
      return ''
    default: {
      const exhaustive: never = layer
      addIssue(state, '/layers', 'unsupported', `未知 MapLibre 样式层类型 ${String((exhaustive as { type?: unknown }).type)}`)
      return ''
    }
  }
}

function reportUnmappedProperties(layer: StyleLayer, state: ExportState): void {
  const handled: Record<string, { paint: string[]; layout: string[] }> = {
    line: {
      paint: ['line-color', 'line-opacity', 'line-width', 'line-dasharray', 'line-translate'],
      layout: ['line-cap', 'line-join']
    },
    circle: {
      paint: ['circle-color', 'circle-opacity', 'circle-radius', 'circle-stroke-color', 'circle-stroke-width', 'circle-stroke-opacity'],
      layout: []
    },
    fill: {
      paint: ['fill-color', 'fill-opacity', 'fill-outline-color', 'fill-pattern'],
      layout: []
    },
    symbol: {
      paint: ['text-color', 'text-opacity', 'text-halo-color', 'text-halo-width'],
      layout: [
        'text-field', 'text-font', 'text-size', 'text-offset', 'text-rotate', 'text-anchor', 'text-max-angle', 'text-padding',
        'text-keep-upright', 'text-allow-overlap', 'text-ignore-placement', 'text-optional', 'symbol-placement', 'symbol-spacing',
        'symbol-avoid-edges', 'icon-optional', 'icon-image', 'icon-size', 'icon-rotate'
      ]
    }
  }
  if (!['line', 'circle', 'fill', 'symbol'].includes(layer.type)) return
  const allowed = handled[layer.type as keyof typeof handled]!
  for (const section of ['paint', 'layout'] as const) {
    const properties = layer[section] as Record<string, unknown> | undefined
    for (const name of Object.keys(properties ?? {})) {
      if (!allowed[section].includes(name)) addIssue(state, `${layerPath(layer)}/${section}/${pathPart(name)}`, 'unsupported', `SLD 导出尚未映射标准属性 ${name}`)
    }
  }
}

function validateMapLibreLayers(layers: readonly LayerSpecification[]): void {
  const sources: StyleSpecification['sources'] = Object.create(null)
  for (const layer of layers) {
    if (!('source' in layer) || Object.hasOwn(sources, layer.source)) continue
    sources[layer.source] = 'source-layer' in layer
      ? { type: 'vector', tiles: ['https://example.invalid/{z}/{x}/{y}.pbf'] }
      : { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
  }
  const errors = validateStyleMin({ version: 8, sources, layers } as StyleSpecification)
  if (errors.length) throw new Error(`MapLibre 样式无效：${errors.map(error => error.message).join('；')}`)
}

function scaleDenominator(zoom: number, context: SldExportContext): number {
  const mapping = context.zoomResolutionMapping
  const tileSize = mapping?.tileSize ?? DEFAULT_TILE_SIZE
  const latitude = mapping?.referenceLatitude ?? 0
  if (!Number.isFinite(tileSize) || tileSize <= 0 || !Number.isFinite(latitude) || Math.abs(latitude) >= 90) throw new Error('Zoom/比例尺映射参数无效')
  const worldWidthMeters = mapping?.worldWidthMeters ?? WORLD_WIDTH_METERS * Math.cos(latitude * Math.PI / 180)
  if (!Number.isFinite(worldWidthMeters) || worldWidthMeters <= 0) throw new Error('Zoom/比例尺映射世界宽度无效')
  const groundScale = worldWidthMeters
  return groundScale / (tileSize * OGC_PIXEL_METERS * 2 ** zoom)
}

function scaleXml(layer: StyleLayer, context: SldExportContext): string {
  const minzoom = layer.minzoom
  const maxzoom = layer.maxzoom
  if (minzoom === undefined && maxzoom === undefined) return ''
  const parts: string[] = []
  if (maxzoom !== undefined) parts.push(`<sld:MinScaleDenominator>${numberText(scaleDenominator(maxzoom, context))}</sld:MinScaleDenominator>`)
  if (minzoom !== undefined) parts.push(`<sld:MaxScaleDenominator>${numberText(scaleDenominator(minzoom, context))}</sld:MaxScaleDenominator>`)
  return parts.join('')
}

function buildRule(layer: StyleLayer, state: ExportState, classifier: Classifier | undefined, plan: RulePlan): string {
  let filter = plan.filter
  const rawFilter = 'filter' in layer ? layer.filter : undefined
  if (rawFilter !== undefined) {
    const expression = convertFilter(rawFilter)
    const parsed = parseFilter(expression, state.context.geometryField, state.context.fieldTypes)
    if (!parsed.supported) addIssue(state, `${layerPath(layer)}/filter`, 'unsupported', parsed.reason ?? 'Filter 不可转换')
    else {
      filter = andFilters(parsed.xml, filter)
      if (parsed.approximated) addIssue(state, `${layerPath(layer)}/filter`, 'approximated', parsed.approximated)
    }
  }
  const symbolizer = symbolizerXml(layer, state, plan, classifier)
  if (!symbolizer) return ''
  const scale = scaleXml(layer, state.context)
  const ruleName = `${layer.id}${plan.classKey ? `-${plan.classKey}` : ''}`
  return `<sld:Rule><sld:Name>${xmlEscape(ruleName)}</sld:Name>${filter ? `<ogc:Filter>${filter}</ogc:Filter>` : ''}${scale}${plan.isFallback && !plan.filter ? '<sld:ElseFilter/>' : ''}${symbolizer}</sld:Rule>`
}

function parseSld(xml: string): void {
  const errors: string[] = []
  const document = new DOMParser({
    onError: (_level, message) => errors.push(message)
  }).parseFromString(xml, 'application/xml')
  if (errors.length || document.documentElement?.localName !== 'StyledLayerDescriptor') throw new Error(`生成的 SLD XML 解析失败：${errors.join('；') || '缺少 StyledLayerDescriptor 根节点'}`)
  new XMLSerializer().serializeToString(document)
}

/** Converts a standard MapLibre style-layer fragment to an SLD 1.0 vector style. */
export function exportSld(layers: readonly LayerSpecification[], context: SldExportContext): SldExportResult {
  if (!context.targetLayerName.trim()) throw new Error('SLD 目标图层名不能为空')
  if (!context.crs.trim()) throw new Error('SLD CRS 不能为空')
  if (context.previewZoom !== undefined && (!Number.isFinite(context.previewZoom) || context.previewZoom < 0 || context.previewZoom > 24)) throw new Error('previewZoom 必须在 0–24 之间')
  validateMapLibreLayers(layers)
  const state: ExportState = { issues: [], assets: [], context, classifiers: new Map(), zoomIssuePaths: new Set() }
  const hasScaleBounds = layers.some(layer => layer.minzoom !== undefined || layer.maxzoom !== undefined)
  if (hasScaleBounds && !context.zoomResolutionMapping && !/^EPSG:(3857|900913)$/i.test(context.crs)) {
    addIssue(state, '/layers', 'approximated', `CRS ${context.crs} 未指定目标地图宽度，比例尺按 EPSG:3857 512px 世界瓦片近似`)
  }
  const featureLayers = layers.filter(layer => layer.type !== 'background')
  for (const layer of layers) {
    if (layer.type === 'background') addIssue(state, layerPath(layer), 'unsupported', 'SLD FeatureTypeStyle 不包含 MapLibre 背景层')
  }
  if (!featureLayers.length) addIssue(state, '/layers', 'unsupported', '没有可导出的矢量样式层')

  const featureStyles = featureLayers.map(layer => {
    if (layer.type === 'raster' || layer.type === 'heatmap' || layer.type === 'hillshade') {
      symbolizerXml(layer, state, { }, undefined)
      return ''
    }
    const classifier = commonClassifier(layer, state)
    const rules = classifier ? classificationRules(classifier) : [{}]
    const xml = rules.map(rule => buildRule(layer, state, classifier, rule)).join('')
    reportUnmappedProperties(layer, state)
    return `<sld:FeatureTypeStyle><sld:Name>${xmlEscape(layer.id)}</sld:Name>${xml}</sld:FeatureTypeStyle>`
  }).join('')

  const hasUnsupported = state.issues.some(issue => issue.level === 'unsupported')
  const xml = `<sld:StyledLayerDescriptor version="1.0.0" xmlns:sld="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd"><sld:NamedLayer><sld:Name>${xmlEscape(context.targetLayerName)}</sld:Name><sld:UserStyle><sld:Name>${xmlEscape(context.targetLayerName)}</sld:Name><sld:Title>${xmlEscape(context.targetLayerName)}</sld:Title>${featureStyles}</sld:UserStyle></sld:NamedLayer></sld:StyledLayerDescriptor>`
  if (!hasUnsupported || !context.strict) parseSld(xml)
  const level = hasUnsupported ? 'unsupported' : state.issues.some(issue => issue.level === 'approximated') ? 'approximated' : 'supported'
  return {
    ...(context.strict && hasUnsupported ? {} : { sldXml: xml }),
    assets: state.assets,
    issues: state.issues,
    level,
    publishable: !hasUnsupported
  }
}
