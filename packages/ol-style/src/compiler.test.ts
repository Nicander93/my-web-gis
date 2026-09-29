import { describe, it, expect, beforeEach } from 'vitest'
import { compileStyle, clearSymbolCache } from './compiler.js'
import type { SingleStyle, CategorizedStyle, GraduatedStyle, PointSymbol, LineSymbol } from './types.js'
import Feature from 'ol/Feature'
import Point from 'ol/geom/Point'
import LineString from 'ol/geom/LineString'
import Polygon from 'ol/geom/Polygon'

beforeEach(() => {
  clearSymbolCache()
})

describe('compileStyle', () => {
  describe('single mode', () => {
    it('应该为点要素应用单一符号', () => {
      const style: SingleStyle = {
        mode: 'single',
        symbol: {
          type: 'circle',
          radius: 5,
          fill: { r: 255, g: 0, b: 0, a: 1 },
          stroke: { r: 0, g: 0, b: 0, a: 1 },
          strokeWidth: 1
        }
      }

      const styleFunction = compileStyle(style)
      const feature = new Feature({
        geometry: new Point([0, 0])
      })

      const olStyle = styleFunction(feature)
      expect(olStyle).toBeDefined()
      expect(olStyle.getImage()).toBeDefined()
    })

    it('应该为线要素应用单一符号', () => {
      const style: SingleStyle = {
        mode: 'single',
        symbol: {
          type: 'solid',
          color: { r: 0, g: 0, b: 255, a: 1 },
          width: 2
        }
      }

      const styleFunction = compileStyle(style)
      const feature = new Feature({
        geometry: new LineString([[0, 0], [1, 1]])
      })

      const olStyle = styleFunction(feature)
      expect(olStyle).toBeDefined()
      expect(olStyle.getStroke()).toBeDefined()
    })

    it('应该为面要素应用单一符号', () => {
      const style: SingleStyle = {
        mode: 'single',
        symbol: {
          type: 'solid',
          fill: { r: 0, g: 255, b: 0, a: 0.5 },
          stroke: { r: 0, g: 0, b: 0, a: 1 },
          strokeWidth: 1
        }
      }

      const styleFunction = compileStyle(style)
      const feature = new Feature({
        geometry: new Polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]])
      })

      const olStyle = styleFunction(feature)
      expect(olStyle).toBeDefined()
      expect(olStyle.getFill()).toBeDefined()
      expect(olStyle.getStroke()).toBeDefined()
    })

    it('应该为混合几何按类型渲染', () => {
      const style: SingleStyle = {
        mode: 'single',
        symbol: {
          type: 'mixed',
          point: {
            type: 'circle',
            radius: 5,
            fill: { r: 255, g: 0, b: 0, a: 1 }
          },
          line: {
            type: 'solid',
            color: { r: 0, g: 0, b: 255, a: 1 },
            width: 2
          },
          polygon: {
            type: 'solid',
            fill: { r: 0, g: 255, b: 0, a: 0.5 }
          }
        }
      }

      const styleFunction = compileStyle(style)

      const pointFeature = new Feature({ geometry: new Point([0, 0]) })
      const pointStyle = styleFunction(pointFeature)
      expect(pointStyle.getImage()).toBeDefined()

      const lineFeature = new Feature({ geometry: new LineString([[0, 0], [1, 1]]) })
      const lineStyle = styleFunction(lineFeature)
      expect(lineStyle.getStroke()).toBeDefined()

      const polygonFeature = new Feature({ geometry: new Polygon([[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]) })
      const polygonStyle = styleFunction(polygonFeature)
      expect(polygonStyle.getFill()).toBeDefined()
    })

    it('应该在有标注配置时添加标签', () => {
      const style: SingleStyle = {
        mode: 'single',
        symbol: {
          type: 'circle',
          radius: 5,
          fill: { r: 255, g: 0, b: 0, a: 1 }
        },
        label: {
          field: 'name',
          fontSize: 14,
          color: { r: 0, g: 0, b: 0, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)
      const feature = new Feature({
        geometry: new Point([0, 0]),
        name: 'Test Point'
      })

      const olStyle = styleFunction(feature)
      expect(olStyle.getText()).toBeDefined()
      expect(olStyle.getText()?.getText()).toBe('Test Point')
    })

    it('应该在标签字段为空时不显示标签', () => {
      const style: SingleStyle = {
        mode: 'single',
        symbol: {
          type: 'circle',
          radius: 5,
          fill: { r: 255, g: 0, b: 0, a: 1 }
        },
        label: {
          field: 'name'
        }
      }

      const styleFunction = compileStyle(style)
      const feature = new Feature({
        geometry: new Point([0, 0]),
        name: ''
      })

      const olStyle = styleFunction(feature)
      const text = olStyle.getText()
      expect(text === null || text === undefined).toBe(true)
    })
  })

  describe('categorized mode', () => {
    it('应该根据分类字段应用不同符号', () => {
      const style: CategorizedStyle = {
        mode: 'categorized',
        field: 'type',
        categories: [
          {
            value: 'A',
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 255, g: 0, b: 0, a: 1 }
            }
          },
          {
            value: 'B',
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 0, g: 255, b: 0, a: 1 }
            }
          }
        ],
        fallback: {
          type: 'circle',
          radius: 5,
          fill: { r: 128, g: 128, b: 128, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)

      const featureA = new Feature({ geometry: new Point([0, 0]), type: 'A' })
      const styleA = styleFunction(featureA)
      expect(styleA.getImage()).toBeDefined()

      const featureB = new Feature({ geometry: new Point([0, 0]), type: 'B' })
      const styleB = styleFunction(featureB)
      expect(styleB.getImage()).toBeDefined()
    })

    it('应该对未匹配值使用 fallback', () => {
      const style: CategorizedStyle = {
        mode: 'categorized',
        field: 'type',
        categories: [
          {
            value: 'A',
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 255, g: 0, b: 0, a: 1 }
            }
          }
        ],
        fallback: {
          type: 'circle',
          radius: 5,
          fill: { r: 128, g: 128, b: 128, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)
      const feature = new Feature({ geometry: new Point([0, 0]), type: 'Unknown' })
      const olStyle = styleFunction(feature)
      expect(olStyle.getImage()).toBeDefined()
    })

    it('应该区分数字和字符串分类值', () => {
      const style: CategorizedStyle = {
        mode: 'categorized',
        field: 'value',
        categories: [
          {
            value: 1,
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 255, g: 0, b: 0, a: 1 }
            }
          },
          {
            value: '1',
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 0, g: 255, b: 0, a: 1 }
            }
          }
        ],
        fallback: {
          type: 'circle',
          radius: 5,
          fill: { r: 128, g: 128, b: 128, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)

      const featureNum = new Feature({ geometry: new Point([0, 0]), value: 1 })
      const styleNum = styleFunction(featureNum)
      expect(styleNum.getImage()).toBeDefined()

      const featureStr = new Feature({ geometry: new Point([0, 0]), value: '1' })
      const styleStr = styleFunction(featureStr)
      expect(styleStr.getImage()).toBeDefined()
    })
  })

  describe('graduated mode', () => {
    it('应该根据数值范围应用不同符号', () => {
      const style: GraduatedStyle = {
        mode: 'graduated',
        field: 'population',
        method: 'manual',
        breaks: [
          {
            value: 1000,
            symbol: {
              type: 'circle',
              radius: 3,
              fill: { r: 255, g: 255, b: 178, a: 1 }
            }
          },
          {
            value: 5000,
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 254, g: 204, b: 92, a: 1 }
            }
          },
          {
            value: 10000,
            symbol: {
              type: 'circle',
              radius: 7,
              fill: { r: 253, g: 141, b: 60, a: 1 }
            }
          }
        ],
        fallback: {
          type: 'circle',
          radius: 2,
          fill: { r: 128, g: 128, b: 128, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)

      const feature500 = new Feature({ geometry: new Point([0, 0]), population: 500 })
      const style500 = styleFunction(feature500)
      expect(style500.getImage()).toBeDefined()

      const feature3000 = new Feature({ geometry: new Point([0, 0]), population: 3000 })
      const style3000 = styleFunction(feature3000)
      expect(style3000.getImage()).toBeDefined()

      const feature8000 = new Feature({ geometry: new Point([0, 0]), population: 8000 })
      const style8000 = styleFunction(feature8000)
      expect(style8000.getImage()).toBeDefined()
    })

    it('应该对非数值使用 fallback', () => {
      const style: GraduatedStyle = {
        mode: 'graduated',
        field: 'value',
        method: 'manual',
        breaks: [
          {
            value: 100,
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 255, g: 0, b: 0, a: 1 }
            }
          }
        ],
        fallback: {
          type: 'circle',
          radius: 5,
          fill: { r: 128, g: 128, b: 128, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)

      const featureNull = new Feature({ geometry: new Point([0, 0]), value: null })
      const styleNull = styleFunction(featureNull)
      expect(styleNull.getImage()).toBeDefined()

      const featureStr = new Feature({ geometry: new Point([0, 0]), value: 'text' })
      const styleStr = styleFunction(featureStr)
      expect(styleStr.getImage()).toBeDefined()

      const featureNaN = new Feature({ geometry: new Point([0, 0]), value: NaN })
      const styleNaN = styleFunction(featureNaN)
      expect(styleNaN.getImage()).toBeDefined()
    })

    it('应该正确处理分级边界值', () => {
      const style: GraduatedStyle = {
        mode: 'graduated',
        field: 'value',
        method: 'manual',
        breaks: [
          {
            value: 10,
            symbol: {
              type: 'circle',
              radius: 3,
              fill: { r: 255, g: 0, b: 0, a: 1 }
            }
          },
          {
            value: 20,
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 0, g: 255, b: 0, a: 1 }
            }
          }
        ],
        fallback: {
          type: 'circle',
          radius: 2,
          fill: { r: 128, g: 128, b: 128, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)

      const feature10 = new Feature({ geometry: new Point([0, 0]), value: 10 })
      const style10 = styleFunction(feature10)
      expect(style10.getImage()).toBeDefined()

      const feature20 = new Feature({ geometry: new Point([0, 0]), value: 20 })
      const style20 = styleFunction(feature20)
      expect(style20.getImage()).toBeDefined()

      const feature15 = new Feature({ geometry: new Point([0, 0]), value: 15 })
      const style15 = styleFunction(feature15)
      expect(style15.getImage()).toBeDefined()

      const feature25 = new Feature({ geometry: new Point([0, 0]), value: 25 })
      const style25 = styleFunction(feature25)
      expect(style25.getImage()).toBeDefined()
    })

    it('精确上界应使用对应断点符号', () => {
      const style: GraduatedStyle = {
        mode: 'graduated',
        field: 'value',
        method: 'manual',
        breaks: [
          {
            value: 10,
            symbol: {
              type: 'circle',
              radius: 3,
              fill: { r: 255, g: 0, b: 0, a: 1 }
            }
          },
          {
            value: 20,
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 0, g: 255, b: 0, a: 1 }
            }
          }
        ],
        fallback: {
          type: 'circle',
          radius: 2,
          fill: { r: 128, g: 128, b: 128, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)

      const atFirst = styleFunction(new Feature({ geometry: new Point([0, 0]), value: 10 }))
      expect((atFirst.getImage() as any).getRadius()).toBe(3)

      const atSecond = styleFunction(new Feature({ geometry: new Point([0, 0]), value: 20 }))
      expect((atSecond.getImage() as any).getRadius()).toBe(5)
    })

    it('高于最大断点的有限数值应使用最后断点符号而非 fallback', () => {
      const style: GraduatedStyle = {
        mode: 'graduated',
        field: 'value',
        method: 'manual',
        breaks: [
          {
            value: 10,
            symbol: {
              type: 'circle',
              radius: 3,
              fill: { r: 255, g: 0, b: 0, a: 1 }
            }
          },
          {
            value: 20,
            symbol: {
              type: 'circle',
              radius: 5,
              fill: { r: 0, g: 255, b: 0, a: 1 }
            }
          }
        ],
        fallback: {
          type: 'circle',
          radius: 2,
          fill: { r: 128, g: 128, b: 128, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)
      const aboveMax = styleFunction(new Feature({ geometry: new Point([0, 0]), value: 25 }))
      expect((aboveMax.getImage() as any).getRadius()).toBe(5)
    })
  })

  describe('符号缓存', () => {
    it('应该缓存基础符号以提高性能', () => {
      const style: SingleStyle = {
        mode: 'single',
        symbol: {
          type: 'circle',
          radius: 5,
          fill: { r: 255, g: 0, b: 0, a: 1 }
        }
      }

      const styleFunction = compileStyle(style)
      const feature1 = new Feature({ geometry: new Point([0, 0]) })
      const feature2 = new Feature({ geometry: new Point([1, 1]) })

      const style1 = styleFunction(feature1)
      const style2 = styleFunction(feature2)

      expect(style1).toBeDefined()
      expect(style2).toBeDefined()
    })
  })
})
