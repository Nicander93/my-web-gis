import { describe, expect, it } from 'vitest'
import type { CartographyState } from '@desktop-webgis/gis-core'
import { createDrawingLayer, setDrawingLayerProperty } from '@desktop-webgis/ol-style/cartography-operations'
import { applyLayerFilterJson, chooseInitialLayerId, createSimpleComparison, readSimpleComparison } from './SymbolEditor'

describe('professional symbol editor filter updates', () => {
  it('selects a requested drawing layer initially without changing the style layers', () => {
    const layers = [
      createDrawingLayer({ id: 'road', source: 'roads', type: 'line' }),
      createDrawingLayer({ id: 'label', source: 'roads', type: 'symbol' })
    ]
    expect(chooseInitialLayerId(layers, 'symbol', 'road')).toBe('road')
    expect(chooseInitialLayerId(layers, 'symbol')).toBe('label')
    expect(chooseInitialLayerId(layers, undefined, 'missing')).toBe('road')
  })

  it('validates a filter edit and preserves unrelated layer AST and source data', () => {
    const line = createDrawingLayer({ id: 'road-core', source: 'roads', type: 'line' })
    const original = setDrawingLayerProperty([line], 'road-core', 'paint', 'line-width', ['interpolate', ['linear'], ['zoom'], 4, 1, 16, 5])
    const withMetadata = {
      ...original[0]!,
      metadata: { vendor: { keep: ['extension', { value: 5 }] } },
      filter: ['==', ['get', 'kind'], 'major']
    } as unknown as CartographyState['styleLayers'][number]
    const result = applyLayerFilterJson([withMetadata], 'road-core', '["==", ["get", "class"], "primary"]')

    expect(result).not.toBe(original)
    expect(result[0]).toMatchObject({
      id: 'road-core',
      metadata: withMetadata.metadata,
      paint: { 'line-color': '#3388ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 16, 5] },
      filter: ['==', ['get', 'class'], 'primary']
    })
    expect('filter' in withMetadata ? withMetadata.filter : undefined).toEqual(['==', ['get', 'kind'], 'major'])
  })

  it('clears a filter explicitly and rejects invalid JSON, invalid filters, or missing targets', () => {
    const line = { ...createDrawingLayer({ id: 'road-core', source: 'roads', type: 'line' }), filter: ['has', 'name'] } as CartographyState['styleLayers'][number]
    expect(applyLayerFilterJson([line], 'road-core', '')[0]).not.toHaveProperty('filter')
    expect(() => applyLayerFilterJson([line], 'road-core', '{')).toThrow()
    expect(() => applyLayerFilterJson([line], 'road-core', '["unknown-filter", 1]')).toThrow(/无效/)
    expect(() => applyLayerFilterJson([line], 'missing', 'null')).toThrow(/不存在/)
  })

  it('adds a standard filter to a new drawing layer that has no filter property yet', () => {
    const line = createDrawingLayer({ id: 'road-core', source: 'roads', type: 'line' })
    expect('filter' in line).toBe(false)

    const filtered = applyLayerFilterJson([line], 'road-core', '["==", ["get", "class"], "primary"]')

    expect(filtered[0]).toMatchObject({ filter: ['==', ['get', 'class'], 'primary'] })
    expect('filter' in line).toBe(false)
  })

  it('builds typed comparisons and leaves unsupported filter expressions unclassified', () => {
    const numeric = createSimpleComparison({ field: 'rank', operator: '>=', valueType: 'number', value: '3.5' })
    const boolean = createSimpleComparison({ field: 'active', operator: '==', valueType: 'boolean', value: 'false' })
    expect(numeric).toEqual(['>=', ['get', 'rank'], 3.5])
    expect(boolean).toEqual(['==', ['get', 'active'], false])
    expect(readSimpleComparison(numeric)).toEqual({ field: 'rank', operator: '>=', valueType: 'number', value: '3.5' })
    expect(readSimpleComparison(['all', ['has', 'rank'], ['>', ['get', 'rank'], 2]])).toBeUndefined()
    expect(() => createSimpleComparison({ field: '', operator: '==', valueType: 'string', value: 'x' })).toThrow(/字段/)
    expect(() => createSimpleComparison({ field: 'rank', operator: '==', valueType: 'number', value: 'NaN' })).toThrow(/有限数值/)
  })

  it('keeps complex text and filter expressions when an unrelated symbol property changes', () => {
    const textExpression = ['concat', ['get', 'name'], ' · ', ['to-string', ['get', 'rank']]]
    const filterExpression = ['all', ['has', 'class'], ['in', ['get', 'class'], ['literal', ['primary', 'secondary']]]]
    const symbol = {
      ...createDrawingLayer({ id: 'place-label', source: 'places', type: 'symbol' }),
      filter: filterExpression,
      layout: { 'text-field': textExpression, 'text-font': ['Open Sans Regular'] }
    } as unknown as CartographyState['styleLayers'][number]

    const updated = setDrawingLayerProperty([symbol], 'place-label', 'paint', 'text-color', '#123456')

    expect(updated[0]).toMatchObject({
      filter: filterExpression,
      layout: { 'text-field': textExpression, 'text-font': ['Open Sans Regular'] },
      paint: { 'text-color': '#123456' }
    })
    expect(symbol.layout).toEqual({ 'text-field': textExpression, 'text-font': ['Open Sans Regular'] })
  })
})
