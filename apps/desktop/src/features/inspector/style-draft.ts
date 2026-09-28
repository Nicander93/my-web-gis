/**
 * 样式草稿辅助：字段枚举、重新分类、色带应用。
 * 重新分类是明确动作；属性编辑沿用现有断点，不在此重算。
 */

import type { GisFeature } from '@desktop-webgis/gis-core'
import { cloneValue } from '@desktop-webgis/gis-core'
import {
  classifyEqualInterval,
  classifyQuantile,
  cloneSymbolWithColor,
  colorToString,
  createCategorizedStyle,
  createGraduatedStyle,
  createSingleStyle,
  generateColorRamp,
  hexToColor,
  ColorRamps,
  rgb,
  type CategoryItem,
  type Color,
  type GraduatedBreak,
  type LabelConfig,
  type LayerStyle,
  type Symbol
} from '@desktop-webgis/ol-style'

export const COLOR_RAMP_OPTIONS = [
  { id: 'BlueRed', label: '蓝→红' },
  { id: 'Grayscale', label: '灰度' },
  { id: 'GreenYellowRed', label: '绿→黄→红' },
  { id: 'Rainbow', label: '彩虹' }
] as const

export type ColorRampId = (typeof COLOR_RAMP_OPTIONS)[number]['id']

export function listAttributeFields(features: GisFeature[]): string[] {
  const names = new Set<string>()
  for (const feature of features) {
    for (const key of Object.keys(feature.properties ?? {})) {
      names.add(key)
    }
  }
  return Array.from(names).sort()
}

export function listNumericFields(features: GisFeature[]): string[] {
  return listAttributeFields(features).filter((field) =>
    features.some((feature) => {
      const value = feature.properties?.[field]
      return typeof value === 'number' && Number.isFinite(value)
    })
  )
}

function baseSymbolFromStyle(style: LayerStyle): Symbol {
  if (style.mode === 'single') return cloneValue(style.symbol)
  if (style.mode === 'categorized') return cloneValue(style.fallback)
  return cloneValue(style.fallback)
}

function rampColors(rampId: string, count: number): Color[] {
  if (count < 1) return []
  if (rampId === 'Rainbow') {
    const stops = ColorRamps.Rainbow.colors
    if (count === 1) return [stops[0]]
    const colors: Color[] = []
    for (let i = 0; i < count; i++) {
      const t = (i / (count - 1)) * (stops.length - 1)
      const lower = Math.floor(t)
      const upper = Math.min(lower + 1, stops.length - 1)
      const frac = t - lower
      colors.push({
        r: Math.round(stops[lower].r + (stops[upper].r - stops[lower].r) * frac),
        g: Math.round(stops[lower].g + (stops[upper].g - stops[lower].g) * frac),
        b: Math.round(stops[lower].b + (stops[upper].b - stops[lower].b) * frac),
        a: 1
      })
    }
    return colors
  }
  if (rampId === 'GreenYellowRed') {
    const { start, middle, end } = ColorRamps.GreenYellowRed
    if (count === 1) return [start]
    const colors: Color[] = []
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1)
      if (t <= 0.5) {
        colors.push(
          generateColorRamp(start, middle, 2).length
            ? {
                r: Math.round(start.r + (middle.r - start.r) * (t * 2)),
                g: Math.round(start.g + (middle.g - start.g) * (t * 2)),
                b: Math.round(start.b + (middle.b - start.b) * (t * 2)),
                a: 1
              }
            : start
        )
      } else {
        const u = (t - 0.5) * 2
        colors.push({
          r: Math.round(middle.r + (end.r - middle.r) * u),
          g: Math.round(middle.g + (end.g - middle.g) * u),
          b: Math.round(middle.b + (end.b - middle.b) * u),
          a: 1
        })
      }
    }
    return colors
  }
  const ramp = rampId === 'Grayscale' ? ColorRamps.Grayscale : ColorRamps.BlueRed
  return generateColorRamp(ramp.start, ramp.end, count)
}

export function colorToHex(color: Color): string {
  const to = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${to(color.r)}${to(color.g)}${to(color.b)}`
}

export function parseHexColor(hex: string, alpha = 1): Color {
  try {
    const color = hexToColor(hex)
    return { ...color, a: alpha }
  } catch {
    return rgb(128, 128, 128)
  }
}

/** 切换模式时保留 label，并给出可编辑的默认结构 */
export function switchStyleMode(current: LayerStyle, mode: LayerStyle['mode']): LayerStyle {
  const label = current.label
  const base = baseSymbolFromStyle(current)
  if (mode === 'single') {
    return createSingleStyle(base, label)
  }
  if (mode === 'categorized') {
    if (current.mode === 'categorized') return current
    return createCategorizedStyle(
      current.mode === 'graduated' ? current.field : '',
      [],
      base,
      label
    )
  }
  if (current.mode === 'graduated') return current
  return createGraduatedStyle(
    current.mode === 'categorized' ? current.field : '',
    'equal-interval',
    [],
    base,
    label
  )
}

export function withLabel(style: LayerStyle, label: LabelConfig | undefined): LayerStyle {
  const next = cloneValue(style)
  if (!label || !label.field) {
    delete next.label
  } else {
    next.label = label
  }
  return next
}

/** 明确的重新分类动作：根据当前字段与方法生成类别/断点并着色 */
export function reclassifyStyle(
  style: LayerStyle,
  features: GisFeature[],
  options: { classCount: number; colorRampId: string }
): { style: LayerStyle; error?: string } {
  const label = style.label
  const base = baseSymbolFromStyle(style)

  if (style.mode === 'single') {
    return { style }
  }

  if (style.mode === 'categorized') {
    if (!style.field) return { style, error: '请先选择分类字段' }
    const seen = new Map<string | number, unknown>()
    for (const feature of features) {
      const value = feature.properties?.[style.field]
      if (value === null || value === undefined || value === '') continue
      if (typeof value === 'number' || typeof value === 'string') {
        if (!seen.has(value)) seen.set(value, value)
      }
    }
    const values = Array.from(seen.keys())
    if (values.length === 0) {
      return { style, error: '字段没有可用于分类的值' }
    }
    const colors = rampColors(options.colorRampId, values.length)
    const categories: CategoryItem[] = values.map((value, index) => ({
      value,
      label: String(value),
      symbol: cloneSymbolWithColor(base, colors[index] ?? colors[colors.length - 1] ?? rgb(128, 128, 128))
    }))
    return {
      style: createCategorizedStyle(style.field, categories, base, label)
    }
  }

  if (!style.field) return { style, error: '请先选择分级字段' }
  const values = features.map((feature) => feature.properties?.[style.field])
  const method = style.method === 'quantile' ? 'quantile' : 'equal-interval'
  const result =
    method === 'quantile'
      ? classifyQuantile(values, { numClasses: options.classCount })
      : classifyEqualInterval(values, { numClasses: options.classCount })

  if (result.error || result.breaks.length === 0) {
    return { style, error: result.error ?? '分级失败' }
  }

  const colors = rampColors(options.colorRampId, result.breaks.length)
  const breaks: GraduatedBreak[] = result.breaks.map((value, index) => ({
    value,
    symbol: cloneSymbolWithColor(base, colors[index] ?? colors[colors.length - 1] ?? rgb(128, 128, 128))
  }))

  return {
    style: createGraduatedStyle(style.field, method, breaks, base, label)
  }
}

export function updateCategoryColor(style: LayerStyle, index: number, hex: string): LayerStyle {
  if (style.mode !== 'categorized') return style
  const next = cloneValue(style)
  const category = next.categories[index]
  if (!category) return style
  category.symbol = cloneSymbolWithColor(category.symbol, parseHexColor(hex))
  return next
}

export function updateBreakColor(style: LayerStyle, index: number, hex: string): LayerStyle {
  if (style.mode !== 'graduated') return style
  const next = cloneValue(style)
  const item = next.breaks[index]
  if (!item) return style
  item.symbol = cloneSymbolWithColor(item.symbol, parseHexColor(hex))
  return next
}

export function updateFallbackColor(style: LayerStyle, hex: string): LayerStyle {
  if (style.mode === 'single') {
    return { ...style, symbol: cloneSymbolWithColor(style.symbol, parseHexColor(hex)) }
  }
  return { ...style, fallback: cloneSymbolWithColor(style.fallback, parseHexColor(hex)) }
}

export { colorToString }
