import { describe, expect, it } from 'vitest'
import { getFieldNameChanges } from '../data/field-identities'
import { rebaseCartographyFieldReferences, remapCartographyFieldReferences, remapLayerFieldReferences } from './field-references'
import { validateCartographyState } from '@desktop-webgis/ol-style/cartography-model'
import type { Layer } from './types'
import { getLayerCartography, reconcileProjectCartography } from './cartography'
import { createProject, createDefaultLayerStyle } from './project'
import { requireMapContent } from './project-content'

function fragment() {
  const project = createProject('Fields'), content = requireMapContent(project)
  content.datasets = [{ id: 'data', kind: 'vector', name: 'Data', source: { type: 'memory', label: 'Data' } }]
  content.layers = [{ id: 'layer', datasetId: 'data', name: 'Data', style: createDefaultLayerStyle('point'), visible: true, editable: true, opacity: 1 }]
  return getLayerCartography(reconcileProjectCartography(project), 'layer')!
}

describe('simultaneous field reference remapping', () => {
  it('retires only dependent historical properties and filter clauses while retaining independent operands', () => {
    const original = fragment(), style = original.styleLayers[0]
    Reflect.set(style, 'paint', { 'circle-radius': ['case', ['has', 'left'], 9, 3],
      'circle-color': ['match', ['get', 'right'], 'left', '#ff0000', '#000000'], 'circle-opacity': 0.75 })
    Reflect.set(style, 'filter', ['all', ['==', 'left', 1], ['any', ['==', ['get', 'left'], 2], ['>', ['get', 'right'], 0]]])
    const mapped = rebaseCartographyFieldReferences(original, new Map([['left', undefined], ['right', 'renamed']]))
    expect(Reflect.get(mapped.styleLayers[0], 'paint')).toEqual({
      'circle-color': ['match', ['get', 'renamed'], 'left', '#ff0000', '#000000'], 'circle-opacity': 0.75 })
    expect(Reflect.get(mapped.styleLayers[0], 'filter')).toEqual(['all', ['any', ['>', ['get', 'renamed'], 0]]])
    expect(validateCartographyState({ specVersion: 8, styleLayers: mapped.styleLayers, bindings: [mapped.binding] })).toEqual([])
    expect(Reflect.get(style, 'paint')).toHaveProperty('circle-radius')
  })

  it('retires historical classification branches and preserves the fallback binding without dangling metadata', () => {
    const original = fragment(), category = structuredClone(original.styleLayers[0]), fallback = structuredClone(category)
    category.id = 'category'; fallback.id = 'fallback'
    category.metadata = { 'my-web-gis:cartography': { classification: { mode: 'categorized', field: 'left', value: 1 } } }
    fallback.metadata = { 'my-web-gis:cartography': { classification: { mode: 'categorized', field: 'left', fallback: true } } }
    Reflect.set(category, 'filter', ['==', 'left', 1]); Reflect.set(fallback, 'filter', ['!=', 'left', 1])
    original.styleLayers = [category, fallback]; original.binding.styleLayerIds = ['category', 'fallback']
    const mapped = rebaseCartographyFieldReferences(original, new Map([['left', undefined]]))
    expect(mapped.binding.styleLayerIds).toEqual(['fallback'])
    expect(mapped.styleLayers.map(style => style.id)).toEqual(['fallback'])
    expect(mapped.styleLayers[0]).not.toHaveProperty('filter')
    expect(mapped.styleLayers[0].metadata).toEqual({ 'my-web-gis:cartography': {} })
    expect(validateCartographyState({ specVersion: 8, styleLayers: mapped.styleLayers, bindings: [mapped.binding] })).toEqual([])
    expect(original.binding.styleLayerIds).toEqual(['category', 'fallback'])
  })

  it('still rejects dynamic property names beside a retired static operand in a historical property', () => {
    const original = fragment()
    Reflect.set(original.styleLayers[0], 'paint', { 'circle-radius': ['case', ['has', 'left'], ['get', ['concat', 'ri', 'ght']], 3] })
    expect(() => rebaseCartographyFieldReferences(original, new Map([['left', undefined]]))).toThrow('动态字段名')
    expect(rebaseCartographyFieldReferences(original, new Map())).toEqual(original)
  })

  it('maps identities before names so a reused name cannot revive a removed column', () => {
    const mapping = getFieldNameChanges(new Map([['left', 'first'], ['right', 'second'], ['same', 'third']]), new Map([['right', 'first'], ['same', 'third']]))
    expect([...mapping]).toEqual([['left', 'right'], ['right', undefined]])
    const config: Pick<Layer, 'style' | 'filter' | 'interaction'> = {
      style: { mode: 'categorized', field: 'right', categories: [{ value: 'left', symbol: { type: 'circle', radius: 8 } }],
        fallback: { type: 'circle', radius: 5 }, label: { field: 'left', fontSize: 12 } },
      filter: [{ field: 'left', op: 'eq', value: 'right' }, { field: 'right', op: 'eq', value: 'left' }],
      interaction: { popup: { titleField: 'right', fields: [{ field: 'left', label: 'left', format: 'text' }, { field: 'right', format: 'text' }] } }
    }
    expect(remapLayerFieldReferences(config, mapping)).toEqual({
      style: { mode: 'single', symbol: { type: 'circle', radius: 5 }, label: { field: 'right', fontSize: 12 } },
      filter: [{ field: 'right', op: 'eq', value: 'right' }],
      interaction: { popup: { fields: [{ field: 'right', label: 'left', format: 'text' }] } }
    })
    expect(config.filter).toHaveLength(2)
    expect(config.interaction!.popup!.titleField).toBe('right')
    expect(getFieldNameChanges(new Map([['right', 'old']]), new Map([['right', 'new']])).get('right')).toBeUndefined()
    expect(getFieldNameChanges(new Map([['right', 'old']]), new Map([['right', 'new']])).has('right')).toBe(true)
  })

  it('maps standard operands simultaneously while preserving literal values and object-local keys', () => {
    const original = fragment(), style = original.styleLayers[0]
    Reflect.set(style, 'paint', {
      'circle-radius': ['case', ['has', 'left', ['properties']], ['get', 'right'], 3],
      'circle-color': ['match', ['get', 'left'], 'left', '#ff0000', '#000000'],
      custom: ['get', 'left', ['literal', { left: 'right' }]]
    })
    Reflect.set(style, 'layout', { 'text-field': ['concat', 'left', ['get', 'left'], ['literal', ['get', 'right']]] })
    Reflect.set(style, 'filter', ['all', ['==', 'left', 'left'], ['==', ['get', 'right'], 'right'], ['==', '$type', 'Point']])
    style.metadata = { 'my-web-gis:cartography': { classification: { field: 'left', title: 'left' } } }
    const mapped = remapCartographyFieldReferences(original, new Map([['left', 'right'], ['right', 'left']])).styleLayers[0]
    expect(Reflect.get(mapped, 'paint')).toEqual({
      'circle-radius': ['case', ['has', 'right', ['properties']], ['get', 'left'], 3],
      'circle-color': ['match', ['get', 'right'], 'left', '#ff0000', '#000000'],
      custom: ['get', 'left', ['literal', { left: 'right' }]]
    })
    expect(Reflect.get(mapped, 'layout')).toEqual({ 'text-field': ['concat', 'left', ['get', 'right'], ['literal', ['get', 'right']]] })
    expect(Reflect.get(mapped, 'filter')).toEqual(['all', ['==', 'right', 'left'], ['==', ['get', 'left'], 'right'], ['==', '$type', 'Point']])
    expect(mapped.metadata).toEqual({ 'my-web-gis:cartography': { classification: { field: 'right', title: 'left' } } })
    expect(style.metadata).toEqual({ 'my-web-gis:cartography': { classification: { field: 'left', title: 'left' } } })
  })

  it('rejects deleted standard operands and dynamic feature-property names before mutating input', () => {
    const original = fragment(), style = original.styleLayers[0]
    Reflect.set(style, 'paint', { 'circle-radius': ['get', 'left'] })
    expect(() => remapCartographyFieldReferences(original, new Map([['left', undefined]]))).toThrow('仍引用字段 left')
    Reflect.set(style, 'paint', { 'circle-radius': ['get', ['concat', 'le', 'ft']] })
    expect(() => remapCartographyFieldReferences(original, new Map([['left', 'right']]))).toThrow('动态字段名')
    expect(Reflect.get(style, 'paint')).toEqual({ 'circle-radius': ['get', ['concat', 'le', 'ft']] })
    Reflect.set(style, 'paint', {})
    style.metadata = { 'my-web-gis:cartography': { classification: { field: 'left' } } }
    expect(() => remapCartographyFieldReferences(original, new Map([['left', undefined]]))).toThrow('仍引用字段 left')
  })
})
