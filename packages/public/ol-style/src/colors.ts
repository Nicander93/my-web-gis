import type { Color } from './types.js'

/**
 * 颜色工具函数
 */

export function rgb(r: number, g: number, b: number): Color {
  return { r, g, b, a: 1 }
}

export function rgba(r: number, g: number, b: number, a: number): Color {
  return { r, g, b, a }
}

export function colorToString(color: Color): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`
}

export function hexToColor(hex: string): Color {
  const cleaned = hex.replace('#', '')
  const r = parseInt(cleaned.substring(0, 2), 16)
  const g = parseInt(cleaned.substring(2, 4), 16)
  const b = parseInt(cleaned.substring(4, 6), 16)
  return { r, g, b, a: 1 }
}

/**
 * 在两个颜色之间线性插值
 */
export function interpolateColor(color1: Color, color2: Color, t: number): Color {
  const r = Math.round(color1.r + (color2.r - color1.r) * t)
  const g = Math.round(color1.g + (color2.g - color1.g) * t)
  const b = Math.round(color1.b + (color2.b - color1.b) * t)
  const a = color1.a + (color2.a - color1.a) * t

  return { r, g, b, a }
}

/**
 * 生成色带
 * 
 * @param startColor 起始颜色
 * @param endColor 结束颜色
 * @param count 颜色数量
 * @returns 颜色数组
 */
export function generateColorRamp(
  startColor: Color,
  endColor: Color,
  count: number
): Color[] {
  if (count < 1) {
    return []
  }

  if (count === 1) {
    return [startColor]
  }

  const colors: Color[] = []

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    colors.push(interpolateColor(startColor, endColor, t))
  }

  return colors
}

/**
 * 预定义色带
 */
export const ColorRamps = {
  /** 蓝-红渐变 */
  BlueRed: {
    start: rgb(33, 102, 172),
    end: rgb(178, 24, 43)
  },
  /** 绿-黄-红渐变(需要生成中间色) */
  GreenYellowRed: {
    start: rgb(0, 168, 107),
    middle: rgb(255, 237, 111),
    end: rgb(237, 28, 36)
  },
  /** 灰度渐变 */
  Grayscale: {
    start: rgb(240, 240, 240),
    end: rgb(50, 50, 50)
  },
  /** 彩虹渐变(简化版) */
  Rainbow: {
    colors: [
      rgb(255, 0, 0),
      rgb(255, 127, 0),
      rgb(255, 255, 0),
      rgb(0, 255, 0),
      rgb(0, 0, 255),
      rgb(75, 0, 130)
    ]
  }
}
