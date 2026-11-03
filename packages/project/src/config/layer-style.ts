import type { LegacyLayerStyle, LayerStyleKind } from './types'
import type { LayerStyle, SingleStyle, Symbol } from '@desktop-webgis/ol-style'

/**
 * 解析 CSS 颜色为 RGBA 分量
 */
function parseCssColor(cssColor: string): { r: number; g: number; b: number; a: number } {
  if (cssColor.startsWith('rgba(')) {
    const match = cssColor.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/)
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: parseFloat(match[4])
      }
    }
  }

  if (cssColor.startsWith('rgb(')) {
    const match = cssColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3]),
        a: 1
      }
    }
  }

  if (cssColor.startsWith('#')) {
    const hex = cssColor.slice(1)
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1
      }
    }
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1
      }
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255
      }
    }
  }

  return { r: 0, g: 0, b: 0, a: 1 }
}

/**
 * 迁移旧样式为新样式
 */
export function migrateLegacyStyle(legacy: LegacyLayerStyle): SingleStyle {
  const strokeColor = parseCssColor(legacy.stroke)
  const fillColor = parseCssColor(legacy.fill)

  let symbol: Symbol

  if (legacy.kind === 'point') {
    symbol = {
      type: 'circle',
      radius: legacy.pointRadius,
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: legacy.width
    }
  } else if (legacy.kind === 'line') {
    symbol = {
      type: 'solid',
      color: strokeColor,
      width: legacy.width
    }
  } else if (legacy.kind === 'polygon') {
    symbol = {
      type: 'solid',
      fill: fillColor,
      stroke: strokeColor,
      strokeWidth: legacy.width
    }
  } else {
    symbol = {
      type: 'mixed',
      point: {
        type: 'circle',
        radius: legacy.pointRadius,
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: legacy.width
      },
      line: {
        type: 'solid',
        color: strokeColor,
        width: legacy.width
      },
      polygon: {
        type: 'solid',
        fill: fillColor,
        stroke: strokeColor,
        strokeWidth: legacy.width
      }
    }
  }

  return {
    mode: 'single',
    symbol
  }
}

/**
 * 判断是否为旧样式
 */
export function isLegacyStyle(style: LegacyLayerStyle | LayerStyle): style is LegacyLayerStyle {
  return 'kind' in style && !('mode' in style)
}

/**
 * 创建默认新样式
 */
export function createDefaultLayerStyle(kind: LayerStyleKind = 'mixed'): SingleStyle {
  const palette: Record<LayerStyleKind, { stroke: string; fill: string; width: number; pointRadius: number }> = {
    point: { stroke: '#4f6f58', fill: '#dbe8da', width: 1.5, pointRadius: 5 },
    line: { stroke: '#5c7185', fill: '#5c718522', width: 2, pointRadius: 4 },
    polygon: { stroke: '#76604f', fill: '#76604f24', width: 1.5, pointRadius: 4 },
    mixed: { stroke: '#586b5d', fill: '#586b5d20', width: 1.5, pointRadius: 4 }
  }

  const legacy: LegacyLayerStyle = {
    kind,
    ...palette[kind]
  }

  return migrateLegacyStyle(legacy)
}
