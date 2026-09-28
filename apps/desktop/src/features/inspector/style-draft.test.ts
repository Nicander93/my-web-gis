import { describe, expect, it } from 'vitest'
import type { GisFeature } from '@desktop-webgis/gis-core'
import { createDefaultLayerStyle } from '@desktop-webgis/gis-core'
import {
  listAttributeFields,
  listNumericFields,
  reclassifyStyle,
  switchStyleMode
} from './style-draft'

function feature(id: string, properties: Record<string, unknown>): GisFeature {
  return {
    id,
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties
  }
}

describe('style-draft helpers', () => {
  const features = [
    feature('1', { name: 'a', pop: 10 }),
    feature('2', { name: 'b', pop: 20 }),
    feature('3', { name: 'a', pop: 30 }),
    feature('4', { name: 'c', pop: null })
  ]

  it('lists attribute and numeric fields', () => {
    expect(listAttributeFields(features)).toEqual(['name', 'pop'])
    expect(listNumericFields(features)).toEqual(['pop'])
  })

  it('reclassify categorized uses existing unique values', () => {
    const base = switchStyleMode(createDefaultLayerStyle('point'), 'categorized')
    const withField = { ...base, field: 'name' }
    const result = reclassifyStyle(withField, features, { classCount: 5, colorRampId: 'BlueRed' })
    expect(result.error).toBeUndefined()
    expect(result.style.mode).toBe('categorized')
    if (result.style.mode === 'categorized') {
      expect(result.style.categories.map((item) => item.value).sort()).toEqual(['a', 'b', 'c'])
    }
  })

  it('reclassify graduated builds breaks without mutating fallback role for invalids', () => {
    const base = switchStyleMode(createDefaultLayerStyle('point'), 'graduated')
    const withField = { ...base, field: 'pop', method: 'equal-interval' as const }
    const result = reclassifyStyle(withField, features, { classCount: 3, colorRampId: 'BlueRed' })
    expect(result.error).toBeUndefined()
    expect(result.style.mode).toBe('graduated')
    if (result.style.mode === 'graduated') {
      expect(result.style.breaks.length).toBeGreaterThan(0)
      expect(result.style.method).toBe('equal-interval')
    }
  })
})
