/**
 * 分类算法模块
 * 
 * 提供等间距和分位数分类算法,不依赖 OpenLayers
 */

export type ClassificationMethod = 'equal-interval' | 'quantile' | 'manual'

export interface ClassificationOptions {
  /** 期望的分类数量 */
  numClasses: number
  /** 可选的手动断点(用于 manual 方法) */
  breaks?: number[]
}

export interface ClassificationResult {
  /** 实际生成的断点数组,升序排列,已去重 */
  breaks: number[]
  /** 被忽略的无效值数量 */
  ignoredCount: number
  /** 错误信息(如果分类失败) */
  error?: string
}

/**
 * 等间距分类
 * 
 * 将数值范围平均分成 numClasses 个区间
 * 
 * @param values 输入数值数组
 * @param options 分类选项
 * @returns 分类结果
 */
export function classifyEqualInterval(
  values: unknown[],
  options: ClassificationOptions
): ClassificationResult {
  const { numClasses } = options

  if (numClasses < 1) {
    return { breaks: [], ignoredCount: 0, error: '分类数量必须至少为 1' }
  }

  const validNumbers = extractValidNumbers(values)
  const ignoredCount = values.length - validNumbers.length

  if (validNumbers.length === 0) {
    return { breaks: [], ignoredCount, error: '没有有效的数值数据' }
  }

  const min = Math.min(...validNumbers)
  const max = Math.max(...validNumbers)

  if (min === max) {
    return { breaks: [min], ignoredCount }
  }

  const interval = (max - min) / numClasses
  const breaks: number[] = []

  for (let i = 1; i < numClasses; i++) {
    breaks.push(min + i * interval)
  }

  breaks.push(max)

  return { breaks: deduplicateBreaks(breaks), ignoredCount }
}

/**
 * 分位数分类
 * 
 * 将数据按数量平均分成 numClasses 个组,使用线性插值计算分位点
 * 
 * 插值规则: 对于 N 个值和分位数 q ∈ [0, 1]
 * - 位置 p = q * (N - 1)
 * - 如果 p 是整数,返回 sorted[p]
 * - 否则在 sorted[floor(p)] 和 sorted[ceil(p)] 之间线性插值
 * 
 * @param values 输入数值数组
 * @param options 分类选项
 * @returns 分类结果
 */
export function classifyQuantile(
  values: unknown[],
  options: ClassificationOptions
): ClassificationResult {
  const { numClasses } = options

  if (numClasses < 1) {
    return { breaks: [], ignoredCount: 0, error: '分类数量必须至少为 1' }
  }

  const validNumbers = extractValidNumbers(values)
  const ignoredCount = values.length - validNumbers.length

  if (validNumbers.length === 0) {
    return { breaks: [], ignoredCount, error: '没有有效的数值数据' }
  }

  const sorted = validNumbers.slice().sort((a, b) => a - b)
  const n = sorted.length

  if (n === 1) {
    return { breaks: [sorted[0]], ignoredCount }
  }

  const breaks: number[] = []

  for (let i = 1; i < numClasses; i++) {
    const q = i / numClasses
    const p = q * (n - 1)
    const lower = Math.floor(p)
    const upper = Math.ceil(p)

    if (lower === upper) {
      breaks.push(sorted[lower])
    } else {
      const fraction = p - lower
      const interpolated = sorted[lower] * (1 - fraction) + sorted[upper] * fraction
      breaks.push(interpolated)
    }
  }

  breaks.push(sorted[n - 1])

  return { breaks: deduplicateBreaks(breaks), ignoredCount }
}

/**
 * 提取有效的有限数值
 * 
 * - 只接受 number 类型且 isFinite 的值
 * - 空字符串不转换为 0
 * - null/undefined 被忽略
 */
function extractValidNumbers(values: unknown[]): number[] {
  const result: number[] = []

  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      result.push(v)
    }
  }

  return result
}

/**
 * 去重断点数组,保持升序
 */
function deduplicateBreaks(breaks: number[]): number[] {
  const unique = Array.from(new Set(breaks))
  unique.sort((a, b) => a - b)
  return unique
}

/**
 * 根据断点对值进行分类
 * 
 * 区间规则:
 * - 第一段包含最小值: value <= breaks[0]
 * - 其他段: breaks[i-1] < value <= breaks[i]
 * 
 * @param value 待分类的值
 * @param breaks 断点数组(升序)
 * @returns 分类索引(0-based),无效值返回 -1
 */
export function classifyValue(value: unknown, breaks: number[]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return -1
  }

  if (breaks.length === 0) {
    return -1
  }

  for (let i = 0; i < breaks.length; i++) {
    if (i === 0) {
      if (value <= breaks[i]) return i
    } else {
      if (value > breaks[i - 1] && value <= breaks[i]) return i
    }
  }

  return breaks.length - 1
}
