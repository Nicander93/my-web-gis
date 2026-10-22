import { createExpression, EvaluationContext, validateStyleMin, type Feature, type LayerSpecification, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'
import {
  createDrawingLayer,
  createLineWidthExpression,
  duplicateDrawingLayer,
  moveDrawingLayer,
  readLineWidthExpression,
  removeDrawingLayer,
  setDrawingLayerProperty,
  setDrawingLayerZoom
} from './cartography-operations.js'

function validate(layers: LayerSpecification[]): string[] {
  const sources: StyleSpecification['sources'] = Object.create(null)
  for (const layer of layers) {
    if ('source' in layer && !Object.hasOwn(sources, layer.source)) {
      sources[layer.source] = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
    }
  }
  return validateStyleMin({ version: 8, sources, layers } as StyleSpecification).map(issue => issue.message)
}

function evaluateWidth(expression: unknown, zoom: number, properties: Record<string, unknown> = {}): number {
  const result = createExpression(expression, 'line-width')
  if (result.result === 'error') throw new Error(result.value.map(issue => issue.message).join('; '))
  const feature: Feature = { type: 2, properties }
  return result.value.evaluate({ zoom }, feature, {})
}

describe('standard cartography layer operations', () => {
  it('creates renderable standard layers validated by MapLibre', () => {
    const layers = (['line', 'circle', 'fill', 'symbol'] as const).map((type, index) => createDrawingLayer({ id: `layer-${index}`, source: 'drawings', type }))
    expect(layers.map(layer => layer.type)).toEqual(['line', 'circle', 'fill', 'symbol'])
    expect(validate(layers)).toEqual([])
  })

  it('updates only a property or zoom bound and preserves the rest of the standard AST', () => {
    const original = createDrawingLayer({ id: 'road', source: 'roads', type: 'line' })
    const metadata = { custom: { nested: [1, { keep: true }] } }
    const filter = ['==', ['get', 'kind'], 'main'] as const
    const layer: LayerSpecification = { ...original, metadata, filter, paint: { ...original.paint, 'line-width': 4 } }
    const changed = setDrawingLayerProperty([layer], 'road', 'paint', 'line-width', 7)
    expect(changed[0]).toMatchObject({ id: 'road', metadata, filter, paint: { 'line-color': '#3388ff', 'line-width': 7 } })
    expect(changed[0]).not.toBe(layer)
    expect(layer.paint?.['line-width']).toBe(4)
    expect(validate(changed)).toEqual([])

    const deleted = setDrawingLayerProperty(changed, 'road', 'paint', 'line-width', undefined)
    expect(deleted[0]?.paint).toEqual({ 'line-color': '#3388ff' })
    const zoomed = setDrawingLayerZoom(deleted, 'road', 3, 18)
    expect(zoomed[0]).toMatchObject({ minzoom: 3, maxzoom: 18 })
    expect(setDrawingLayerZoom(zoomed, 'road')[0]).not.toHaveProperty('minzoom')
    expect(validate(zoomed)).toEqual([])
  })

  it('moves, duplicates, and removes by stable ID without mutating the input order', () => {
    const initial = ['a', 'b', 'c'].map(id => createDrawingLayer({ id, source: 'drawings', type: 'circle' }))
    const moved = moveDrawingLayer(initial, 'c', 0)
    expect(moved.map(layer => layer.id)).toEqual(['c', 'a', 'b'])
    expect(initial.map(layer => layer.id)).toEqual(['a', 'b', 'c'])
    const duplicated = duplicateDrawingLayer(moved, 'a', 'a-copy')
    expect(duplicated.map(layer => layer.id)).toEqual(['c', 'a', 'a-copy', 'b'])
    expect(duplicated[1]).toEqual({ ...duplicated[2], id: 'a' })
    expect(duplicated[1]).not.toBe(duplicated[2])
    expect(removeDrawingLayer(duplicated, 'a-copy').map(layer => layer.id)).toEqual(['c', 'a', 'b'])
    expect(validate(duplicated)).toEqual([])
  })

  it('rejects invalid standard properties, duplicate IDs, missing layers, and invalid zoom ranges', () => {
    const line = createDrawingLayer({ id: 'line', source: 'roads', type: 'line' })
    expect(() => setDrawingLayerProperty([line], 'line', 'paint', 'line-width', -1)).toThrow(/无效/)
    expect(() => moveDrawingLayer([line, { ...line, id: 'line' }], 'line', 0)).toThrow(/重复/)
    expect(() => removeDrawingLayer([line], 'missing')).toThrow(/不存在/)
    expect(() => setDrawingLayerZoom([line], 'line', 12, 12)).toThrow(/小于/)
    expect(() => duplicateDrawingLayer([line], 'line', 'line')).toThrow(/已存在/)
  })
})

describe('line width expression plans', () => {
  it('creates and reads fixed, field, linear zoom, and step zoom plans', () => {
    const fixed = createLineWidthExpression({ kind: 'fixed', value: 3 })
    const field = createLineWidthExpression({ kind: 'field', field: 'width', factor: 2 })
    const linear = createLineWidthExpression({ kind: 'zoom-linear', stops: [{ zoom: 0, width: 1 }, { zoom: 10, width: 11 }] })
    const step = createLineWidthExpression({ kind: 'zoom-step', base: 1, stops: [{ zoom: 5, width: 4 }, { zoom: 12, width: 9 }] })
    expect(readLineWidthExpression(fixed)).toEqual({ kind: 'fixed', value: 3 })
    expect(readLineWidthExpression(field)).toEqual({ kind: 'field', field: 'width', factor: 2 })
    expect(readLineWidthExpression(linear)).toEqual({ kind: 'zoom-linear', stops: [{ zoom: 0, width: 1 }, { zoom: 10, width: 11 }] })
    expect(readLineWidthExpression(step)).toEqual({ kind: 'zoom-step', base: 1, stops: [{ zoom: 5, width: 4 }, { zoom: 12, width: 9 }] })
  })

  it('matches MapLibre style-spec expression evaluation, including safe numeric fallback', () => {
    const field = createLineWidthExpression({ kind: 'field', field: 'width', factor: 2 })
    const linear = createLineWidthExpression({ kind: 'zoom-linear', stops: [{ zoom: 0, width: 2 }, { zoom: 10, width: 12 }] })
    const step = createLineWidthExpression({ kind: 'zoom-step', base: 1, stops: [{ zoom: 5, width: 4 }, { zoom: 12, width: 9 }] })
    expect(evaluateWidth(field, 3, { width: 4 })).toBe(8)
    expect(evaluateWidth(field, 3, { width: '4' })).toBe(0)
    expect(evaluateWidth(linear, 5)).toBe(7)
    expect(evaluateWidth(step, 4)).toBe(1)
    expect(evaluateWidth(step, 5)).toBe(4)
    expect(evaluateWidth(step, 12)).toBe(9)
    const line = createDrawingLayer({ id: 'dynamic-line', source: 'roads', type: 'line' })
    expect(validate(setDrawingLayerProperty([line], 'dynamic-line', 'paint', 'line-width', field))).toEqual([])
    expect(validate(setDrawingLayerProperty([line], 'dynamic-line', 'paint', 'line-width', linear))).toEqual([])
    expect(validate(setDrawingLayerProperty([line], 'dynamic-line', 'paint', 'line-width', step))).toEqual([])
  })

  it('preserves unknown legal expressions exactly and rejects invalid plans', () => {
    const expression = ['case', ['has', 'priority'], ['get', 'priority'], 2]
    const result = readLineWidthExpression(expression)
    expect(result).toEqual({ kind: 'expression', expression })
    expect(result.kind === 'expression' && result.expression).toBe(expression)
    expect(() => readLineWidthExpression(['unknown-operator', 1])).toThrow(/表达式无效/)
    expect(() => createLineWidthExpression({ kind: 'zoom-linear', stops: [{ zoom: 5, width: 1 }, { zoom: 5, width: 2 }] })).toThrow(/stop/)
    expect(() => createLineWidthExpression({ kind: 'zoom-linear', stops: [{ zoom: -1, width: 1 }, { zoom: 5, width: 2 }] })).toThrow(/stop/)
    expect(() => createLineWidthExpression({ kind: 'zoom-step', base: 1, stops: [] })).toThrow(/stop/)
  })
})
