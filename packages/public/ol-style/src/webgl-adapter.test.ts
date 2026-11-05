import { describe, expect, it } from 'vitest'
import { createWebGLStylePlan } from './webgl-adapter.js'
import { BUILTIN_SYMBOL_PRESETS } from './symbol-library.js'

describe('conservative WebGL adapter', () => {
  it('preserves casing order, literal alpha and MapLibre Zoom offset without changing AST', () => {
    const layers = structuredClone(BUILTIN_SYMBOL_PRESETS.find(preset => preset.id === 'builtin:road-primary-v1')!.layers)
    const before = structuredClone(layers)
    const plan = createWebGLStylePlan(layers)
    expect(plan.supported, JSON.stringify(plan.issues)).toBe(true)
    expect(plan.layers.map(layer => layer.id)).toEqual(layers.map(layer => layer.id))
    expect(layers).toEqual(before)
    const circle = createWebGLStylePlan([{ id: 'points', source: 's', type: 'circle', minzoom: 3, maxzoom: 12, paint: { 'circle-color': 'rgba(255,0,0,0.5)', 'circle-opacity': 0.5, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 20, 10] } }])
    expect(circle.layers[0].rules[0].style['circle-fill-color']).toEqual([255, 0, 0, 0.25])
    expect(circle.layers[0].rules[0].style['circle-radius']).toEqual(['interpolate', ['linear'], ['-', ['zoom'], 1], 0, 2, 20, 10])
    expect(circle.layers[0].rules[0].filter).toContainEqual(['<', ['-', ['zoom'], 1], 12])
  })
  it('reports every unsupported property and rejects the whole GIS fragment', () => {
    const plan = createWebGLStylePlan([
      { id: 'road', source: 's', type: 'line', paint: { 'line-offset': 2, 'line-width': ['*', ['get', 'width'], 2] } },
      { id: 'label', source: 's', type: 'symbol', layout: { 'text-field': ['get', 'name'] } }
    ])
    expect(plan.supported).toBe(false)
    expect(plan.layers).toEqual([])
    expect(plan.issues.map(issue => issue.path)).toEqual(expect.arrayContaining(['/layers/road/paint/line-offset', '/layers/road/paint/line-width', '/layers/label']))
  })
  it('keeps legacy geometry filters and fixed dash units but falls back for attribute coercion', () => {
    const plan = createWebGLStylePlan([{ id: 'road', source: 's', type: 'line', filter: ['==', '$type', 'LineString'], paint: { 'line-width': 4, 'line-dasharray': [3, 2] } }])
    expect(plan.supported).toBe(true)
    expect(plan.layers[0].rules[0].style['stroke-line-dash']).toEqual([12, 8])
    expect(createWebGLStylePlan([{ id: 'road', source: 's', type: 'line', filter: ['==', ['get', 'class'], 'main'] }]).supported).toBe(false)
  })
})
