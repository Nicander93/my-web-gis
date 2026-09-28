import { describe, it, expect } from 'vitest'
import {
  classifyEqualInterval,
  classifyQuantile,
  classifyValue,
  type ClassificationResult
} from './index'

describe('classification algorithms', () => {
  describe('classifyEqualInterval', () => {
    it('正确计算等间距断点', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const result = classifyEqualInterval(values, { numClasses: 5 })

      expect(result.error).toBeUndefined()
      expect(result.ignoredCount).toBe(0)
      expect(result.breaks).toEqual([2.8, 4.6, 6.4, 8.2, 10])
    })

    it('处理常量数据', () => {
      const values = [5, 5, 5, 5]
      const result = classifyEqualInterval(values, { numClasses: 3 })

      expect(result.error).toBeUndefined()
      expect(result.breaks).toEqual([5])
    })

    it('忽略无效值并返回计数', () => {
      const values = [1, 2, '', 4, null, undefined, NaN, Infinity, -Infinity, '10']
      const result = classifyEqualInterval(values, { numClasses: 2 })

      expect(result.ignoredCount).toBe(7)
      expect(result.breaks).toEqual([2.5, 4])
    })

    it('空字符串不转换为 0', () => {
      const values = ['', 0, 1, 2]
      const result = classifyEqualInterval(values, { numClasses: 2 })

      expect(result.breaks).toEqual([1, 2])
      expect(result.ignoredCount).toBe(1)
    })

    it('空数值集返回错误', () => {
      const values = ['', null, undefined, NaN]
      const result = classifyEqualInterval(values, { numClasses: 3 })

      expect(result.error).toBe('没有有效的数值数据')
      expect(result.breaks).toEqual([])
      expect(result.ignoredCount).toBe(4)
    })

    it('去重断点', () => {
      const values = [0, 0, 0, 10, 10, 10]
      const result = classifyEqualInterval(values, { numClasses: 5 })

      expect(result.breaks.length).toBeLessThanOrEqual(5)
      expect(new Set(result.breaks).size).toBe(result.breaks.length)
    })
  })

  describe('classifyQuantile', () => {
    it('正确计算分位数断点', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const result = classifyQuantile(values, { numClasses: 5 })

      expect(result.error).toBeUndefined()
      expect(result.ignoredCount).toBe(0)
      
      // 浮点数精度问题,使用近似比较
      expect(result.breaks).toHaveLength(5)
      expect(result.breaks[0]).toBeCloseTo(2.8, 10)
      expect(result.breaks[1]).toBeCloseTo(4.6, 10)
      expect(result.breaks[2]).toBeCloseTo(6.4, 10)
      expect(result.breaks[3]).toBeCloseTo(8.2, 10)
      expect(result.breaks[4]).toBe(10)
    })

    it('处理大量重复值不生成空图例项', () => {
      const values = [1, 1, 1, 1, 1, 1, 1, 1, 2, 10]
      const result = classifyQuantile(values, { numClasses: 5 })

      expect(result.breaks.length).toBeLessThanOrEqual(5)
      
      const uniqueBreaks = new Set(result.breaks)
      expect(uniqueBreaks.size).toBe(result.breaks.length)
    })

    it('处理单个值', () => {
      const values = [42]
      const result = classifyQuantile(values, { numClasses: 3 })

      expect(result.breaks).toEqual([42])
    })

    it('忽略无效值', () => {
      const values = [1, 2, 3, '', null, undefined]
      const result = classifyQuantile(values, { numClasses: 2 })

      expect(result.ignoredCount).toBe(3)
      expect(result.breaks).toEqual([2, 3])
    })

    it('线性插值规则', () => {
      const values = [10, 20]
      const result = classifyQuantile(values, { numClasses: 2 })

      expect(result.breaks).toEqual([15, 20])
    })
  })

  describe('classifyValue', () => {
    const breaks = [10, 20, 30]

    it('第一段包含最小值', () => {
      expect(classifyValue(5, breaks)).toBe(0)
      expect(classifyValue(10, breaks)).toBe(0)
    })

    it('其他段上界包含,下界不含', () => {
      expect(classifyValue(10.1, breaks)).toBe(1)
      expect(classifyValue(20, breaks)).toBe(1)
      expect(classifyValue(20.1, breaks)).toBe(2)
      expect(classifyValue(30, breaks)).toBe(2)
    })

    it('超出最大值归入最后一段', () => {
      expect(classifyValue(40, breaks)).toBe(2)
    })

    it('无效值返回 -1', () => {
      expect(classifyValue('', breaks)).toBe(-1)
      expect(classifyValue(null, breaks)).toBe(-1)
      expect(classifyValue(undefined, breaks)).toBe(-1)
      expect(classifyValue(NaN, breaks)).toBe(-1)
      expect(classifyValue(Infinity, breaks)).toBe(-1)
    })

    it('空断点数组返回 -1', () => {
      expect(classifyValue(15, [])).toBe(-1)
    })

    it('边界测试', () => {
      const values = [9.9, 10, 10.1, 19.9, 20, 20.1, 29.9, 30, 30.1]
      const expected = [0, 0, 1, 1, 1, 2, 2, 2, 2]

      values.forEach((v, i) => {
        expect(classifyValue(v, breaks)).toBe(expected[i])
      })
    })
  })

  describe('颜色数与有效分段一致', () => {
    it('等间距分类', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const result = classifyEqualInterval(values, { numClasses: 5 })

      expect(result.breaks.length).toBe(5)
    })

    it('分位数分类', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      const result = classifyQuantile(values, { numClasses: 5 })

      expect(result.breaks.length).toBe(5)
    })

    it('重复值去重后分段减少', () => {
      const values = [1, 1, 1, 10, 10, 10]
      const result = classifyQuantile(values, { numClasses: 5 })

      expect(result.breaks.length).toBeLessThan(5)
    })
  })

  describe('类型区分', () => {
    it('区分数字 1 和字符串 "1"', () => {
      const values = [1, '1', 2, '2']
      const result = classifyEqualInterval(values, { numClasses: 2 })

      expect(result.ignoredCount).toBe(2)
      expect(result.breaks).toEqual([1.5, 2])
    })
  })
})
