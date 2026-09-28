/**
 * OpenLayers StyleFunction 编译器
 * 
 * 将样式配置编译为 OpenLayers StyleFunction
 */

import type { FeatureLike } from 'ol/Feature'
import type { Geometry } from 'ol/geom'
import CircleStyle from 'ol/style/Circle'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import Style from 'ol/style/Style'
import Text from 'ol/style/Text'

import type {
  LayerStyle,
  Symbol,
  PointSymbol,
  LineSymbol,
  PolygonSymbol,
  MixedSymbol,
  Color,
  LabelConfig,
  GeometryKind
} from './types'
import { isCategorizedStyle, isGraduatedStyle } from './style-factory'

/**
 * 颜色转换为 OL 格式
 */
function colorToOlColor(color: Color): string {
  return `rgba(${color.r},${color.g},${color.b},${color.a})`
}

/**
 * 符号缓存
 */
class SymbolCache {
  private cache = new Map<string, Style>()
  private maxSize = 1000

  get(key: string): Style | undefined {
    return this.cache.get(key)
  }

  set(key: string, style: Style): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, style)
  }

  clear(): void {
    this.cache.clear()
  }
}

const symbolCache = new SymbolCache()

/**
 * 生成符号缓存键
 */
function getSymbolCacheKey(symbol: Symbol, geometryType?: string): string {
  return JSON.stringify({ symbol, geometryType })
}

/**
 * 编译点符号
 */
function compilePointSymbol(symbol: PointSymbol): CircleStyle {
  return new CircleStyle({
    radius: symbol.radius,
    fill: symbol.fill ? new Fill({ color: colorToOlColor(symbol.fill) }) : undefined,
    stroke: symbol.stroke
      ? new Stroke({
          color: colorToOlColor(symbol.stroke),
          width: symbol.strokeWidth ?? 1
        })
      : undefined
  })
}

/**
 * 编译线符号
 */
function compileLineSymbol(symbol: LineSymbol): { stroke: Stroke } {
  return {
    stroke: new Stroke({
      color: colorToOlColor(symbol.color),
      width: symbol.width
    })
  }
}

/**
 * 编译面符号
 */
function compilePolygonSymbol(symbol: PolygonSymbol): { fill?: Fill; stroke?: Stroke } {
  return {
    fill: symbol.fill ? new Fill({ color: colorToOlColor(symbol.fill) }) : undefined,
    stroke: symbol.stroke
      ? new Stroke({
          color: colorToOlColor(symbol.stroke),
          width: symbol.strokeWidth ?? 1
        })
      : undefined
  }
}

/**
 * 从缓存获取或创建样式
 */
function getOrCreateStyle(
  symbol: Symbol,
  geometryType?: string,
  labelText?: string,
  labelConfig?: LabelConfig
): Style {
  const cacheKey = getSymbolCacheKey(symbol, geometryType)
  let baseStyle = symbolCache.get(cacheKey)

  if (!baseStyle) {
    if (symbol.type === 'circle') {
      baseStyle = new Style({
        image: compilePointSymbol(symbol)
      })
    } else if (symbol.type === 'solid' && 'width' in symbol) {
      const lineSymbol = compileLineSymbol(symbol as LineSymbol)
      baseStyle = new Style({
        stroke: lineSymbol.stroke
      })
    } else if (symbol.type === 'solid' && 'fill' in symbol) {
      const polygonSymbol = compilePolygonSymbol(symbol as PolygonSymbol)
      baseStyle = new Style({
        fill: polygonSymbol.fill,
        stroke: polygonSymbol.stroke
      })
    } else if (symbol.type === 'mixed') {
      const mixedSymbol = symbol as MixedSymbol
      const actualType = geometryType?.toLowerCase()

      if (actualType?.includes('point') && mixedSymbol.point) {
        baseStyle = new Style({
          image: compilePointSymbol(mixedSymbol.point)
        })
      } else if (actualType?.includes('line') && mixedSymbol.line) {
        const lineSymbol = compileLineSymbol(mixedSymbol.line)
        baseStyle = new Style({
          stroke: lineSymbol.stroke
        })
      } else if (actualType?.includes('polygon') && mixedSymbol.polygon) {
        const polygonSymbol = compilePolygonSymbol(mixedSymbol.polygon)
        baseStyle = new Style({
          fill: polygonSymbol.fill,
          stroke: polygonSymbol.stroke
        })
      } else {
        baseStyle = new Style()
      }
    } else {
      baseStyle = new Style()
    }

    symbolCache.set(cacheKey, baseStyle)
  }

  if (labelText && labelConfig) {
    const styleOptions: any = {
      text: new Text({
        text: labelText,
        font: `${labelConfig.fontSize ?? 12}px sans-serif`,
        fill: labelConfig.color
          ? new Fill({ color: colorToOlColor(labelConfig.color) })
          : new Fill({ color: '#000000' }),
        stroke: labelConfig.strokeColor
          ? new Stroke({
              color: colorToOlColor(labelConfig.strokeColor),
              width: labelConfig.strokeWidth ?? 1
            })
          : undefined
      })
    }

    const baseFill = baseStyle.getFill()
    const baseStroke = baseStyle.getStroke()
    const baseImage = baseStyle.getImage()

    if (baseFill) styleOptions.fill = baseFill
    if (baseStroke) styleOptions.stroke = baseStroke
    if (baseImage) styleOptions.image = baseImage

    return new Style(styleOptions)
  }

  return baseStyle
}

/**
 * 获取要素的标签文本
 */
function getLabelText(feature: FeatureLike, labelConfig?: LabelConfig): string | undefined {
  if (!labelConfig) return undefined

  const value = feature.get(labelConfig.field)
  if (value === null || value === undefined || value === '') {
    return undefined
  }

  return String(value)
}

/**
 * 编译单一符号样式
 */
function compileSingleStyle(
  style: LayerStyle & { mode: 'single' }
): (feature: FeatureLike) => Style {
  return (feature: FeatureLike) => {
    const geometry = feature.getGeometry()
    const geometryType = geometry?.getType()
    const labelText = getLabelText(feature, style.label)

    return getOrCreateStyle(style.symbol, geometryType, labelText, style.label)
  }
}

/**
 * 编译分类样式
 */
function compileCategorizedStyle(
  style: LayerStyle & { mode: 'categorized' }
): (feature: FeatureLike) => Style {
  const categoryMap = new Map<number | string, Symbol>()
  for (const category of style.categories) {
    categoryMap.set(category.value, category.symbol)
  }

  return (feature: FeatureLike) => {
    const fieldValue = feature.get(style.field)
    const symbol = categoryMap.get(fieldValue) ?? style.fallback

    const geometry = feature.getGeometry()
    const geometryType = geometry?.getType()
    const labelText = getLabelText(feature, style.label)

    return getOrCreateStyle(symbol, geometryType, labelText, style.label)
  }
}

/**
 * 编译分级样式
 */
function compileGraduatedStyle(
  style: LayerStyle & { mode: 'graduated' }
): (feature: FeatureLike) => Style {
  const sortedBreaks = [...style.breaks].sort((a, b) => a.value - b.value)

  return (feature: FeatureLike) => {
    const fieldValue = feature.get(style.field)

    let symbol = style.fallback
    if (typeof fieldValue === 'number' && isFinite(fieldValue)) {
      for (const breakItem of sortedBreaks) {
        if (fieldValue <= breakItem.value) {
          symbol = breakItem.symbol
          break
        }
      }
    }

    const geometry = feature.getGeometry()
    const geometryType = geometry?.getType()
    const labelText = getLabelText(feature, style.label)

    return getOrCreateStyle(symbol, geometryType, labelText, style.label)
  }
}

/**
 * 编译样式配置为 OpenLayers StyleFunction
 */
export function compileStyle(style: LayerStyle): (feature: FeatureLike) => Style {
  if (style.mode === 'single') {
    return compileSingleStyle(style)
  } else if (isCategorizedStyle(style)) {
    return compileCategorizedStyle(style)
  } else if (isGraduatedStyle(style)) {
    return compileGraduatedStyle(style)
  } else {
    throw new Error(`Unsupported style mode: ${(style as LayerStyle).mode}`)
  }
}

/**
 * 清除符号缓存
 */
export function clearSymbolCache(): void {
  symbolCache.clear()
}
