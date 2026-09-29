import type {
  PointSymbol,
  LineSymbol,
  PolygonSymbol,
  MixedSymbol,
  Symbol,
  Color
} from './types.js'

/**
 * 符号工具函数
 */

export function createPointSymbol(
  radius: number,
  fill?: Color,
  stroke?: Color,
  strokeWidth?: number
): PointSymbol {
  return {
    type: 'circle',
    radius,
    fill,
    stroke,
    strokeWidth
  }
}

export function createLineSymbol(
  color: Color,
  width: number
): LineSymbol {
  return {
    type: 'solid',
    color,
    width
  }
}

export function createPolygonSymbol(
  fill?: Color,
  stroke?: Color,
  strokeWidth?: number
): PolygonSymbol {
  return {
    type: 'solid',
    fill,
    stroke,
    strokeWidth
  }
}

export function createMixedSymbol(
  point?: PointSymbol,
  line?: LineSymbol,
  polygon?: PolygonSymbol
): MixedSymbol {
  return {
    type: 'mixed',
    point,
    line,
    polygon
  }
}

/**
 * 克隆符号并修改颜色
 */
export function cloneSymbolWithColor(symbol: Symbol, color: Color): Symbol {
  if (symbol.type === 'circle') {
    return { ...symbol, fill: color }
  } else if (symbol.type === 'solid' && 'color' in symbol) {
    return { ...symbol, color }
  } else if (symbol.type === 'solid' && 'fill' in symbol) {
    return { ...symbol, fill: color }
  } else if (symbol.type === 'mixed') {
    return {
      ...symbol,
      point: symbol.point ? cloneSymbolWithColor(symbol.point, color) as PointSymbol : undefined,
      line: symbol.line ? cloneSymbolWithColor(symbol.line, color) as LineSymbol : undefined,
      polygon: symbol.polygon ? cloneSymbolWithColor(symbol.polygon, color) as PolygonSymbol : undefined
    }
  }

  return symbol
}
