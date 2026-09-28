import type {
  LayerStyle,
  SingleStyle,
  CategorizedStyle,
  GraduatedStyle,
  Symbol,
  CategoryItem,
  GraduatedBreak,
  LabelConfig
} from './types'

/**
 * 样式工厂函数
 */

export function createSingleStyle(
  symbol: Symbol,
  label?: LabelConfig
): SingleStyle {
  return {
    mode: 'single',
    symbol,
    label
  }
}

export function createCategorizedStyle(
  field: string,
  categories: CategoryItem[],
  fallback: Symbol,
  label?: LabelConfig
): CategorizedStyle {
  return {
    mode: 'categorized',
    field,
    categories,
    fallback,
    label
  }
}

export function createGraduatedStyle(
  field: string,
  method: 'equal-interval' | 'quantile' | 'manual',
  breaks: GraduatedBreak[],
  fallback: Symbol,
  label?: LabelConfig
): GraduatedStyle {
  return {
    mode: 'graduated',
    field,
    method,
    breaks,
    fallback,
    label
  }
}

/**
 * 根据样式模式判断样式类型
 */
export function isSingleStyle(style: LayerStyle): style is SingleStyle {
  return style.mode === 'single'
}

export function isCategorizedStyle(style: LayerStyle): style is CategorizedStyle {
  return style.mode === 'categorized'
}

export function isGraduatedStyle(style: LayerStyle): style is GraduatedStyle {
  return style.mode === 'graduated'
}
