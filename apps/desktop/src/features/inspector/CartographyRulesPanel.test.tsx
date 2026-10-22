import { describe, expect, it } from 'vitest'
import type { CartographyState } from '@desktop-webgis/gis-core'
import { createDrawingLayer } from '@desktop-webgis/ol-style/cartography-operations'
import { setRuleLayerVisibility, summarizeRuleFilter } from './CartographyRulesPanel'

describe('cartography rules panel AST operations', () => {
  it('changes only standard layout visibility and preserves filter, metadata, paint, and expressions', () => {
    const filter = ['all', ['has', 'class'], ['==', ['get', 'class'], 'primary']]
    const width = ['interpolate', ['linear'], ['zoom'], 4, 1, 16, 5]
    const layer = {
      ...createDrawingLayer({ id: 'road-main', source: 'roads', type: 'line' }),
      filter,
      minzoom: 3,
      paint: { 'line-color': '#456789', 'line-width': width },
      metadata: { vendor: { route: ['unmodeled', 2] } }
    } as unknown as CartographyState['styleLayers'][number]

    const hidden = setRuleLayerVisibility([layer], 'road-main', false)

    expect(hidden[0]).toMatchObject({
      id: 'road-main',
      filter,
      minzoom: 3,
      paint: { 'line-color': '#456789', 'line-width': width },
      layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
      metadata: layer.metadata
    })
    expect(layer.layout).toEqual({ 'line-cap': 'round', 'line-join': 'round' })
    expect(setRuleLayerVisibility(hidden, 'road-main', true)[0]?.layout?.visibility).toBe('visible')
  })

  it('summarizes absent and complex filters without parsing or rewriting their AST', () => {
    const complex = ['match', ['get', 'class'], ['primary', 'secondary'], true, false]
    expect(summarizeRuleFilter(undefined)).toBe('全部要素')
    expect(summarizeRuleFilter(complex)).toBe(JSON.stringify(complex))
    expect(summarizeRuleFilter(['all', ...Array.from({ length: 20 }, (_, index) => ['==', ['get', `field-${index}`], index])])).toMatch(/…$/)
  })
})
