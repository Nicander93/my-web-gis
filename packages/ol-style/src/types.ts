/**
 * 样式契约类型定义
 * 
 * JSON 可序列化的样式配置,不依赖 OpenLayers 运行时
 */

export type GeometryKind = 'point' | 'line' | 'polygon' | 'mixed'

export type StyleMode = 'single' | 'categorized' | 'graduated'

/**
 * 颜色定义 (RGBA)
 */
export interface Color {
  r: number
  g: number
  b: number
  a: number
}

/**
 * 点符号
 */
export interface PointSymbol {
  type: 'circle'
  radius: number
  fill?: Color
  stroke?: Color
  strokeWidth?: number
}

/**
 * 线符号
 */
export interface LineSymbol {
  type: 'solid'
  color: Color
  width: number
}

/**
 * 面符号
 */
export interface PolygonSymbol {
  type: 'solid'
  fill?: Color
  stroke?: Color
  strokeWidth?: number
}

/**
 * 混合几何符号(包含点、线、面)
 */
export interface MixedSymbol {
  type: 'mixed'
  point?: PointSymbol
  line?: LineSymbol
  polygon?: PolygonSymbol
}

export type Symbol = PointSymbol | LineSymbol | PolygonSymbol | MixedSymbol

/**
 * 分类项
 */
export interface CategoryItem {
  /** 分类值(可以是数字或字符串) */
  value: number | string
  /** 符号 */
  symbol: Symbol
  /** 显示标签 */
  label?: string
}

/**
 * 分级断点
 */
export interface GraduatedBreak {
  /** 断点值(上界) */
  value: number
  /** 符号 */
  symbol: Symbol
  /** 显示标签 */
  label?: string
}

/**
 * 标注配置
 */
export interface LabelConfig {
  /** 标注字段 */
  field: string
  /** 字体大小(像素) */
  fontSize?: number
  /** 字体颜色 */
  color?: Color
  /** 描边颜色 */
  strokeColor?: Color
  /** 描边宽度 */
  strokeWidth?: number
  /** 最小缩放级别(可选) */
  minZoom?: number
  /** 最大缩放级别(可选) */
  maxZoom?: number
}

/**
 * 单一符号样式
 */
export interface SingleStyle {
  mode: 'single'
  symbol: Symbol
  label?: LabelConfig
}

/**
 * 分类样式
 */
export interface CategorizedStyle {
  mode: 'categorized'
  /** 分类字段 */
  field: string
  /** 分类项 */
  categories: CategoryItem[]
  /** 未匹配值的默认符号 */
  fallback: Symbol
  label?: LabelConfig
}

/**
 * 分级样式
 */
export interface GraduatedStyle {
  mode: 'graduated'
  /** 分级字段 */
  field: string
  /** 分级方法 */
  method: 'equal-interval' | 'quantile' | 'manual'
  /** 分级断点 */
  breaks: GraduatedBreak[]
  /** 未匹配值的默认符号 */
  fallback: Symbol
  label?: LabelConfig
}

export type LayerStyle = SingleStyle | CategorizedStyle | GraduatedStyle

/**
 * 样式配置
 */
export interface StyleConfig {
  /** 样式 */
  style: LayerStyle
  /** 几何类型(用于混合几何按类型渲染) */
  geometryKind?: GeometryKind
}
