import { describe, expect, it } from 'vitest'
import { buildLegendItems, symbolPrimaryColor } from './legend.js'
import type { CategorizedStyle, GraduatedStyle, SingleStyle } from './types.js'

describe('buildLegendItems', () => {
  it('single 模式生成一项', () => {
    const style: SingleStyle = {
      mode: 'single',
      symbol: {
        type: 'circle',
        radius: 5,
        fill: { r: 10, g: 20, b: 30, a: 1 }
      }
    }
    const items = buildLegendItems(style)
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('全部')
    expect(items[0].color).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(items[0].kind).toBe('point')
  })

  it('categorized 使用已有类别，不重新分类，并附带 fallback', () => {
    const style: CategorizedStyle = {
      mode: 'categorized',
      field: 'type',
      categories: [
        {
          value: 'A',
          label: '类型 A',
          symbol: { type: 'circle', radius: 4, fill: { r: 255, g: 0, b: 0, a: 1 } }
        },
        {
          value: 'B',
          symbol: { type: 'circle', radius: 4, fill: { r: 0, g: 255, b: 0, a: 1 } }
        }
      ],
      fallback: { type: 'circle', radius: 3, fill: { r: 1, g: 2, b: 3, a: 1 } }
    }
    const items = buildLegendItems(style)
    expect(items.map((i) => i.label)).toEqual(['类型 A', 'B', '其他'])
    expect(items[2].color).toEqual({ r: 1, g: 2, b: 3, a: 1 })
  })

  it('graduated 使用已有断点，上界标签与 fallback 一致', () => {
    const style: GraduatedStyle = {
      mode: 'graduated',
      field: 'pop',
      method: 'manual',
      breaks: [
        { value: 10, symbol: { type: 'solid', color: { r: 0, g: 0, b: 255, a: 1 }, width: 2 } },
        { value: 20, label: '高', symbol: { type: 'solid', color: { r: 255, g: 0, b: 0, a: 1 }, width: 3 } }
      ],
      fallback: { type: 'solid', color: { r: 9, g: 9, b: 9, a: 1 }, width: 1 }
    }
    const items = buildLegendItems(style)
    expect(items).toHaveLength(3)
    expect(items[0].label).toBe('≤ 10')
    expect(items[1].label).toBe('高')
    expect(items[2].label).toBe('其他')
    expect(items[0].kind).toBe('line')
  })
})

describe('symbolPrimaryColor', () => {
  it('线符号取 stroke 色', () => {
    expect(
      symbolPrimaryColor({ type: 'solid', color: { r: 1, g: 2, b: 3, a: 1 }, width: 2 })
    ).toEqual({ r: 1, g: 2, b: 3, a: 1 })
  })
})
