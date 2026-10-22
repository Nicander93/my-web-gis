import { Color, convertFilter, type LayerSpecification } from '@maplibre/maplibre-gl-style-spec'
import type { FlatStyle, Rule } from 'ol/style/flat.js'
import type { ExpressionValue } from 'ol/expr/expression.js'

export interface WebGLStyleIssue { path: string; reason: string }
export interface WebGLStylePlan {
  supported: boolean
  issues: WebGLStyleIssue[]
  /** One native layer per drawing layer preserves casing/surface ordering. */
  layers: Array<{ id: string; rules: Rule[] }>
}

/** Conservative MapLibre -> OL 10.10 WebGL subset. Unsupported content falls back as a whole GIS layer. */
export function createWebGLStylePlan(layers: readonly LayerSpecification[]): WebGLStylePlan {
  const issues: WebGLStyleIssue[] = []
  function reject(path: string, reason: string): undefined { issues.push({ path, reason }); return undefined }
  function numeric(value: unknown, path: string): ExpressionValue | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (Array.isArray(value) && value.length >= 7 && value.length % 2 === 1 && value[0] === 'interpolate' && JSON.stringify(value[1]) === '["linear"]' && JSON.stringify(value[2]) === '["zoom"]' && value.slice(3).every(item => typeof item === 'number' && Number.isFinite(item))) {
      // OL world tiles are 256px; MapLibre zoom is one lower at the same resolution.
      return ['interpolate', ['linear'], ['-', ['zoom'], 1], ...value.slice(3)] as ExpressionValue
    }
    return reject(path, 'WebGL 数值仅支持常量或线性 Zoom 插值；其他表达式保留并使用 Canvas')
  }
  function color(value: unknown, opacity: unknown, path: string): ExpressionValue | undefined {
    if (typeof value !== 'string' || typeof opacity !== 'number' || !Number.isFinite(opacity)) return reject(path, 'WebGL 颜色和透明度当前需要固定值')
    const parsed = Color.parse(value)
    if (!parsed) return reject(path, '颜色无效')
    const array = parsed.rgb
    return [array[0] * 255, array[1] * 255, array[2] * 255, array[3] * opacity]
  }
  function filter(value: unknown, path: string): ExpressionValue | undefined {
    if (typeof value === 'boolean') return value
    if (!Array.isArray(value)) return reject(path, 'WebGL 过滤条件格式不受支持')
    if (['all', 'any'].includes(value[0])) {
      const children = value.slice(1).map(child => filter(child, path))
      return children.every(child => child !== undefined) ? (children.length === 1 ? children[0] : children.length ? [value[0], ...children] as ExpressionValue : value[0] === 'all') : undefined
    }
    if (value[0] === '!' && value.length === 2) {
      const child = filter(value[1], path)
      return child === undefined ? undefined : ['!', child]
    }
    // Geometry predicates are type-stable; feature property coercions differ across backends.
    if (['==', '!='].includes(value[0]) && JSON.stringify(value[1]) === '["geometry-type"]' && ['Point', 'LineString', 'Polygon'].includes(value[2])) return structuredClone(value) as ExpressionValue
    return reject(path, 'WebGL 暂不转换属性过滤及类型保护，避免 GPU 类型转换改变语义')
  }
  const plans: WebGLStylePlan['layers'] = []
  for (const layer of layers) {
    const path = `/layers/${layer.id.replace(/~/g, '~0').replace(/\//g, '~1')}`
    if (!['line', 'fill', 'circle'].includes(layer.type)) { reject(path, `WebGL 暂不支持 ${layer.type}；文字和图片继续使用 Canvas`); continue }
    const paint = (layer.paint ?? {}) as Record<string, unknown>, layout = (layer.layout ?? {}) as Record<string, unknown>
    const mapped = new Set<string>(), mappedLayout = new Set(['visibility'])
    const style: Record<string, ExpressionValue | undefined> = {}
    function number(name: string, output: string, fallback: number) { mapped.add(name); style[output] = numeric(paint[name] ?? fallback, `${path}/paint/${name}`) }
    function paintColor(name: string, opacity: string, output: string, fallback: string) { mapped.add(name); mapped.add(opacity); style[output] = color(paint[name] ?? fallback, paint[opacity] ?? 1, `${path}/paint/${name}`) }
    if (layer.type === 'line') {
      paintColor('line-color', 'line-opacity', 'stroke-color', '#000000')
      number('line-width', 'stroke-width', 1)
      for (const [name, output, fallback] of [['line-cap', 'stroke-line-cap', 'butt'], ['line-join', 'stroke-line-join', 'miter']] as const) {
        mappedLayout.add(name)
        if (typeof (layout[name] ?? fallback) !== 'string') reject(`${path}/layout/${name}`, 'WebGL 线帽和连接需要固定值')
        else style[output] = (layout[name] ?? fallback) as string
      }
      mappedLayout.add('line-miter-limit')
      style['stroke-miter-limit'] = numeric(layout['line-miter-limit'] ?? 2, `${path}/layout/line-miter-limit`)
      if (paint['line-dasharray'] !== undefined) {
        mapped.add('line-dasharray')
        const dash = paint['line-dasharray'], width = paint['line-width'] ?? 1
        if (Array.isArray(dash) && dash.every(value => typeof value === 'number' && value >= 0) && typeof width === 'number') style['stroke-line-dash'] = dash.map(value => value * width)
        else reject(`${path}/paint/line-dasharray`, '虚线需要固定数组和线宽')
      }
    } else if (layer.type === 'circle') {
      paintColor('circle-color', 'circle-opacity', 'circle-fill-color', '#000000')
      paintColor('circle-stroke-color', 'circle-stroke-opacity', 'circle-stroke-color', '#000000')
      number('circle-radius', 'circle-radius', 5)
      number('circle-stroke-width', 'circle-stroke-width', 0)
    } else {
      paintColor('fill-color', 'fill-opacity', 'fill-color', '#000000')
      mapped.add('fill-outline-color')
      style['stroke-color'] = color(paint['fill-outline-color'] ?? paint['fill-color'] ?? '#000000', paint['fill-opacity'] ?? 1, `${path}/paint/fill-outline-color`)
      style['stroke-width'] = 1
    }
    for (const key of Object.keys(paint)) if (!mapped.has(key)) reject(`${path}/paint/${key}`, '该属性尚未通过 WebGL 兼容性验证')
    for (const key of Object.keys(layout)) if (!mappedLayout.has(key)) reject(`${path}/layout/${key}`, '该布局属性尚未通过 WebGL 兼容性验证')
    const predicates: ExpressionValue[] = [['==', ['geometry-type'], layer.type === 'line' ? 'LineString' : layer.type === 'fill' ? 'Polygon' : 'Point']]
    if ('filter' in layer && layer.filter !== undefined) {
      const converted = filter(convertFilter(layer.filter), `${path}/filter`)
      if (converted !== undefined) predicates.push(converted)
    }
    if (layer.minzoom !== undefined) predicates.push(['>=', ['-', ['zoom'], 1], layer.minzoom])
    if (layer.maxzoom !== undefined) predicates.push(['<', ['-', ['zoom'], 1], layer.maxzoom])
    if (layout.visibility === 'none') predicates.push(false)
    plans.push({ id: layer.id, rules: [{ filter: predicates.length === 1 ? predicates[0] : ['all', ...predicates], style: style as FlatStyle }] })
  }
  return { supported: issues.length === 0, issues, layers: issues.length ? [] : plans }
}
