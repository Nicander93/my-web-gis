/**
 * 从图例配置生成图例项（纯函数，不依赖 OpenLayers）
 */

import type { Color, LayerStyle, Symbol } from './types.js'

export type LegendGeometryKind = 'point' | 'line' | 'polygon'

export interface LegendItem {
  /** 图例显示文本 */
  label: string
  /** 预览主色 */
  color: Color
  /** 几何示意类型 */
  kind: LegendGeometryKind
}

function inferKind(symbol: Symbol): LegendGeometryKind {
  if (symbol.type === 'circle') return 'point'
  if (symbol.type === 'solid' && 'width' in symbol && !('fill' in symbol)) return 'line'
  if (symbol.type === 'mixed') {
    if (symbol.polygon) return 'polygon'
    if (symbol.line) return 'line'
    return 'point'
  }
  return 'polygon'
}

/** 取符号用于图例色块的主色 */
export function symbolPrimaryColor(symbol: Symbol): Color {
  if (symbol.type === 'circle') {
    return symbol.fill ?? symbol.stroke ?? { r: 128, g: 128, b: 128, a: 1 }
  }
  if (symbol.type === 'solid' && 'color' in symbol) {
    return symbol.color
  }
  if (symbol.type === 'solid' && 'fill' in symbol) {
    return symbol.fill ?? symbol.stroke ?? { r: 128, g: 128, b: 128, a: 1 }
  }
  if (symbol.type === 'mixed') {
    if (symbol.polygon) return symbolPrimaryColor(symbol.polygon)
    if (symbol.line) return symbolPrimaryColor(symbol.line)
    if (symbol.point) return symbolPrimaryColor(symbol.point)
  }
  return { r: 128, g: 128, b: 128, a: 1 }
}

/**
 * 从已应用的图层样式生成图例项。
 * 与编译器共用同一套类别/断点结果，不重新分类。
 */
export function buildLegendItems(style: LayerStyle): LegendItem[] {
  if (style.mode === 'single') {
    return [
      {
        label: '全部',
        color: symbolPrimaryColor(style.symbol),
        kind: inferKind(style.symbol)
      }
    ]
  }

  if (style.mode === 'categorized') {
    const items: LegendItem[] = style.categories.map((category) => ({
      label: category.label ?? String(category.value),
      color: symbolPrimaryColor(category.symbol),
      kind: inferKind(category.symbol)
    }))
    items.push({
      label: '其他',
      color: symbolPrimaryColor(style.fallback),
      kind: inferKind(style.fallback)
    })
    return items
  }

  const sorted = [...style.breaks].sort((a, b) => a.value - b.value)
  const items: LegendItem[] = sorted.map((breakItem, index) => {
    const previous = index === 0 ? undefined : sorted[index - 1].value
    const defaultLabel =
      previous === undefined
        ? `≤ ${breakItem.value}`
        : `${previous} < x ≤ ${breakItem.value}`
    return {
      label: breakItem.label ?? defaultLabel,
      color: symbolPrimaryColor(breakItem.symbol),
      kind: inferKind(breakItem.symbol)
    }
  })
  items.push({
    label: '其他',
    color: symbolPrimaryColor(style.fallback),
    kind: inferKind(style.fallback)
  })
  return items
}
