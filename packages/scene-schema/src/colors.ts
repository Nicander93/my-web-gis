import type { SceneColor } from './types.js'

/** Parse CSS hex / rgb(a) color strings into SceneColor. Returns null when unparseable. */
export function parseCssColor(cssColor: string): SceneColor | null {
  const value = cssColor.trim()

  if (value.startsWith('rgba(')) {
    const match = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/)
    if (!match) return null
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: Number(match[4])
    }
  }

  if (value.startsWith('rgb(')) {
    const match = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/)
    if (!match) return null
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: 1
    }
  }

  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3 && /^[0-9a-fA-F]{3}$/.test(hex)) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: 1
      }
    }
    if (hex.length === 6 && /^[0-9a-fA-F]{6}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1
      }
    }
    if (hex.length === 8 && /^[0-9a-fA-F]{8}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255
      }
    }
  }

  return null
}

/** Require a parseable CSS color; throws with a stable message for migration/runtime. */
export function requireCssColor(cssColor: string, path: string): SceneColor {
  const color = parseCssColor(cssColor)
  if (!color) {
    throw new Error(`${path}: 无法解析颜色 "${cssColor}"`)
  }
  return color
}
