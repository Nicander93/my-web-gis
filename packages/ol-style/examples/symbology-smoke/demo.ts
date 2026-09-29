/**
 * 独立消费者示例：分类、两种分级、标注、图例。
 * 不依赖本仓库其他私有包；仅使用 @desktop-webgis/ol-style 与 peer `ol`。
 */
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import {
  buildLegendItems,
  classifyEqualInterval,
  classifyQuantile,
  compileStyle,
  createCategorizedStyle,
  createGraduatedStyle,
  createPointSymbol,
  generateColorRamp,
  rgb,
  type LayerStyle
} from '@desktop-webgis/ol-style'

const fallback = createPointSymbol(3, rgb(160, 160, 160))

/** 分类样式 + 标注 */
export function buildCategorizedExample(): LayerStyle {
  return createCategorizedStyle(
    'kind',
    [
      { value: 'station', label: '站点', symbol: createPointSymbol(6, rgb(220, 50, 50)) },
      { value: 'depot', label: '车场', symbol: createPointSymbol(6, rgb(50, 120, 220)) }
    ],
    fallback,
    {
      field: 'name',
      fontSize: 12,
      color: rgb(20, 20, 20),
      strokeColor: rgb(255, 255, 255),
      strokeWidth: 2,
      offsetY: -10
    }
  )
}

/** 等间距分级 */
export function buildEqualIntervalExample(values: number[]): LayerStyle {
  const { breaks, error } = classifyEqualInterval(values, { numClasses: 4 })
  if (error || breaks.length === 0) {
    throw new Error(error ?? '等间距分类失败')
  }
  const colors = generateColorRamp(rgb(255, 245, 160), rgb(180, 20, 20), breaks.length)
  return createGraduatedStyle(
    'population',
    'equal-interval',
    breaks.map((value, index) => ({
      value,
      symbol: createPointSymbol(5, colors[index]),
      label: `≤ ${value}`
    })),
    fallback,
    { field: 'name', fontSize: 11, color: rgb(30, 30, 30) }
  )
}

/** 分位数分级 */
export function buildQuantileExample(values: number[]): LayerStyle {
  const { breaks, error } = classifyQuantile(values, { numClasses: 4 })
  if (error || breaks.length === 0) {
    throw new Error(error ?? '分位数分类失败')
  }
  const colors = generateColorRamp(rgb(180, 220, 255), rgb(10, 60, 140), breaks.length)
  return createGraduatedStyle(
    'population',
    'quantile',
    breaks.map((value, index) => ({
      value,
      symbol: createPointSymbol(5, colors[index]),
      label: `≤ ${value}`
    })),
    fallback,
    { field: 'name', fontSize: 11, color: rgb(30, 30, 30) }
  )
}

export interface SmokeResult {
  categorizedLegendLabels: string[]
  equalBreakCount: number
  quantileBreakCount: number
  compiledStyleKeys: string[]
}

/** 运行示例并返回可断言的摘要（供消费者 typecheck / 执行） */
export function runSymbologySmoke(): SmokeResult {
  const populations = [12, 40, 55, 80, 120, 200, 350, 500]
  const categorized = buildCategorizedExample()
  const equal = buildEqualIntervalExample(populations)
  const quantile = buildQuantileExample(populations)

  const categorizedLegend = buildLegendItems(categorized)
  const equalLegend = buildLegendItems(equal)
  const quantileLegend = buildLegendItems(quantile)

  const styleFn = compileStyle(categorized)
  const feature = new Feature({
    geometry: new Point([120, 30]),
    kind: 'station',
    name: '示例站'
  })
  const olStyle = styleFn(feature)
  if (!olStyle) {
    throw new Error('compileStyle 未返回 OpenLayers Style')
  }

  return {
    categorizedLegendLabels: categorizedLegend.map((item) => item.label),
    equalBreakCount: equalLegend.length,
    quantileBreakCount: quantileLegend.length,
    compiledStyleKeys: ['categorized', 'equal-interval', 'quantile']
  }
}

const result = runSymbologySmoke()
console.log(JSON.stringify(result, null, 2))
