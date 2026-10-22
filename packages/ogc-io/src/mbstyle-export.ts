import { validateStyleMin, type LayerSpecification, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'

export type MbStyleCompatibilityLevel = 'supported' | 'approximated' | 'unsupported'

export interface MbStyleCompatibilityIssue {
  path: string
  level: MbStyleCompatibilityLevel
  reason: string
}

export interface MbStyleExportContext {
  name: string
  strict?: boolean
}

export interface MbStyleExportResult {
  json?: string
  hash?: string
  issues: MbStyleCompatibilityIssue[]
  level: MbStyleCompatibilityLevel
  publishable: boolean
}

const commonLayout = new Set(['visibility'])
const supportedPaint: Record<string, ReadonlySet<string>> = {
  line: new Set(['line-color', 'line-opacity', 'line-width', 'line-dasharray']),
  fill: new Set(['fill-color', 'fill-opacity', 'fill-outline-color']),
  circle: new Set(['circle-radius', 'circle-color', 'circle-stroke-width', 'circle-stroke-color']),
  symbol: new Set(['text-color', 'text-halo-color', 'text-halo-width'])
}
const supportedLayout: Record<string, ReadonlySet<string>> = {
  line: new Set(['line-cap', 'line-join']),
  fill: new Set(),
  circle: new Set(),
  symbol: new Set(['symbol-placement', 'text-field', 'text-font', 'text-size', 'text-anchor', 'text-offset'])
}
const filterOperators = new Set(['all', 'any', 'none', '!', '==', '!=', '<', '<=', '>', '>=', 'in', '!in', 'has', '!has'])
const expressionOperators = new Set(['get', 'has', 'feature-state', 'id', 'geometry-type', 'properties', 'zoom', 'heatmap-density', 'line-progress', 'accumulated', 'literal', 'case', 'match', 'step', 'interpolate', 'interpolate-hcl', 'interpolate-lab', 'coalesce', 'let', 'var', '!', 'to-string', 'to-number', 'to-boolean', 'typeof', '+', '-', '*', '/', '%', '^', '==', '!=', '<', '<=', '>', '>=', 'all', 'any', 'in', '!in', 'concat', 'at', 'slice', 'length', 'upcase', 'downcase', 'resolved-locale', 'number-format', 'format', 'image'])
const numberLiteral = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
const scalarLiteral = (value: unknown): boolean => value === null || typeof value === 'string' || typeof value === 'boolean' || numberLiteral(value)
const jsonLiteral = (value: unknown): boolean => scalarLiteral(value) || Array.isArray(value)
  && !(typeof value[0] === 'string' && expressionOperators.has(value[0]))
  && value.every(scalarLiteral)

function validFilter(node: unknown, depth = 0): boolean {
  if (!Array.isArray(node) || depth > 32 || typeof node[0] !== 'string' || !filterOperators.has(node[0])) return false
  const op = node[0]
  if (['all', 'any', 'none'].includes(op)) return node.length >= 2 && node.slice(1).every(child => validFilter(child, depth + 1))
  if (op === '!') return node.length === 2 && validFilter(node[1], depth + 1)
  if (op === 'has' || op === '!has') return (node.length === 2 || node.length === 3) && typeof node[1] === 'string' && (node.length === 2 || Array.isArray(node[2]) && node[2].length === 1 && node[2][0] === 'properties')
  const left = node[1]
  const field = typeof left === 'string' && !left.startsWith('$')
    || Array.isArray(left) && left.length === 2 && left[0] === 'get' && typeof left[1] === 'string'
    || Array.isArray(left) && left.length === 1 && left[0] === 'geometry-type'
  return node.length >= 3 && field && node.slice(2).every(jsonLiteral)
}

function validTextField(value: unknown): boolean {
  return typeof value === 'string' || Array.isArray(value) && value.length === 2 && value[0] === 'get' && typeof value[1] === 'string'
}

function isSimpleValue(value: unknown, property: string): boolean {
  if (property === 'text-field') return validTextField(value)
  return jsonLiteral(value)
}

function issue(issues: MbStyleCompatibilityIssue[], path: string, level: MbStyleCompatibilityLevel, reason: string): void {
  issues.push({ path, level, reason })
}

function makeValidationStyle(layers: readonly LayerSpecification[]): StyleSpecification {
  const sources: StyleSpecification['sources'] = Object.create(null)
  const validationLayers = layers.map((layer, index) => {
    if (!('source' in layer)) return layer
    const sourceId = `__mbstyle_validation_${index}`
    sources[sourceId] = layer.type === 'raster'
        ? { type: 'raster', tiles: ['https://example.invalid/{z}/{x}/{y}.png'] }
        : 'source-layer' in layer
        ? { type: 'vector', tiles: ['https://example.invalid/{z}/{x}/{y}.pbf'] }
        : { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
    return { ...layer, source: sourceId }
  })
  return { version: 8, name: 'GeoServer MBStyle validation', sources, layers: validationLayers } as StyleSpecification
}

function stableJson(value: unknown, depth = 0, state = { nodes: 0 }): string {
  if (depth > 100) throw new Error('MBStyle JSON 结构过深')
  if (++state.nodes > 100000) throw new Error('MBStyle JSON 节点过多')
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item, depth + 1, state)).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableJson(object[key], depth + 1, state)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Exports only a conservative GeoServer MBStyle subset. Source bindings are
 * deliberately omitted because the published GeoServer layer is selected by
 * the catalog association; sprites, patterns and external resources are not
 * inlined or fetched.
 */
export async function exportMbStyle(layers: readonly LayerSpecification[], context: MbStyleExportContext): Promise<MbStyleExportResult> {
  if (!context.name.trim()) throw new Error('MBStyle 名称不能为空')
  if (layers.length > 1000) throw new Error('MBStyle 图层数量过多')
  const validationErrors = validateStyleMin(makeValidationStyle(layers)).map(error => error.message)
  if (validationErrors.length) throw new Error(`MapLibre 样式无效：${validationErrors.join('；')}`)

  const issues: MbStyleCompatibilityIssue[] = []
  const outputLayers: Record<string, unknown>[] = []
  for (const [index, layer] of layers.entries()) {
    const basePath = `/layers/${index}`
    if (layer.type === 'background' || !['line', 'circle', 'fill', 'symbol'].includes(layer.type)) {
      issue(issues, `${basePath}/type`, 'unsupported', `GeoServer MBStyle 导出不支持 ${layer.type} 图层`)
      continue
    }
    const featureLayer = layer as Exclude<LayerSpecification, { type: 'background' }>
    if ('source' in featureLayer) issue(issues, `${basePath}/source`, 'approximated', '源绑定由目标 GeoServer 图层决定，导出时省略')
    if ('source-layer' in featureLayer) issue(issues, `${basePath}/source-layer`, 'unsupported', 'source-layer 对应矢量瓦片源，不能映射到本次 FeatureType')
    if (featureLayer.metadata !== undefined) issue(issues, `${basePath}/metadata`, 'approximated', 'MapLibre 本地元数据不参与 GeoServer 样式渲染，导出时省略')

    const output: Record<string, unknown> = { id: featureLayer.id, type: featureLayer.type }
    if (featureLayer.minzoom !== undefined) { output.minzoom = featureLayer.minzoom; issue(issues, `${basePath}/minzoom`, 'approximated', 'GeoServer WMS 比例尺与 MapLibre zoom 的映射取决于请求 CRS 和输出尺寸') }
    if (featureLayer.maxzoom !== undefined) { output.maxzoom = featureLayer.maxzoom; issue(issues, `${basePath}/maxzoom`, 'approximated', 'GeoServer WMS 比例尺与 MapLibre zoom 的映射取决于请求 CRS 和输出尺寸') }
    if (featureLayer.filter !== undefined) {
      if (validFilter(featureLayer.filter)) output.filter = featureLayer.filter
      else issue(issues, `${basePath}/filter`, 'unsupported', '过滤器超出支持的字段比较/逻辑/存在性子集')
    }

    for (const section of ['layout', 'paint'] as const) {
      const properties = featureLayer[section] as Record<string, unknown> | undefined
      if (!properties) continue
      const allowed = section === 'paint' ? supportedPaint[layer.type] : new Set([...commonLayout, ...supportedLayout[layer.type]])
      const selected: Record<string, unknown> = {}
      for (const [name, value] of Object.entries(properties)) {
        const path = `${basePath}/${section}/${name}`
        if (!allowed.has(name)) {
          issue(issues, path, 'unsupported', ['icon-image', 'fill-pattern', 'line-pattern'].includes(name)
            ? '外部/内嵌图像资源未包含在 MBStyle 包中，本导出明确拒绝'
            : `GeoServer MBStyle 保守支持矩阵未包含 ${name}`)
          continue
        }
        if (section === 'paint' && !isSimpleValue(value, name)) {
          issue(issues, path, 'unsupported', '仅支持标准字面量；动态表达式未确认 GeoServer MBStyle 语义')
          continue
        }
        if (section === 'layout' && !isSimpleValue(value, name)) {
          issue(issues, path, 'unsupported', '仅支持标准字面量；动态布局表达式未确认 GeoServer MBStyle 语义')
          continue
        }
        selected[name] = value
        if (layer.type === 'symbol' && section === 'layout' && name === 'text-font') issue(issues, path, 'approximated', '字体栈依赖 GeoServer 主机安装字体，服务器与本地渲染可能不同')
      }
      if (Object.keys(selected).length) output[section] = selected
    }
    outputLayers.push(output)
  }
  if (layers.length === 0) issue(issues, '/layers', 'unsupported', '没有可发布的绘制层')

  const unsupported = issues.some(entry => entry.level === 'unsupported')
  const approximated = issues.some(entry => entry.level === 'approximated')
  const level = unsupported ? 'unsupported' : approximated ? 'approximated' : 'supported'
  if (context.strict && unsupported) return { issues, level, publishable: false }
  const document = { version: 8, name: context.name.trim(), layers: outputLayers }
  const json = `${JSON.stringify(document, null, 2)}\n`
  const hash = await sha256(stableJson(document))
  return { json, hash, issues, level, publishable: !unsupported }
}

/** Hashes JSON semantically while preserving every array's layer/expression order. */
export async function fingerprintMbStyle(content: string): Promise<string> {
  if (content.length > 4 * 1024 * 1024) throw new Error('MBStyle 内容超过 4 MiB')
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { throw new Error('MBStyle 必须是有效 JSON') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as Record<string, unknown>).version !== 8 || !Array.isArray((parsed as Record<string, unknown>).layers)) throw new Error('需要 version 8 的 MBStyle JSON')
  return sha256(stableJson(parsed))
}
