import { describe, expect, it } from 'vitest'
import { featureFilter, validateStyleMin, type Feature as MapFeature, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { stylefunction } from 'ol-mapbox-style'
import Feature from 'ol/Feature.js'
import LineString from 'ol/geom/LineString.js'
import Point from 'ol/geom/Point.js'
import Polygon from 'ol/geom/Polygon.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import { compileStyle } from './compiler.js'
import { buildCartographyLegendItems, assembleCartographyStyle, createCartographyState, migrateLayerStyle, validateCartographyState } from './cartography-model.js'
import type { LayerStyle, Symbol } from './types.js'

const red: Symbol = { type: 'circle', radius: 6, fill: { r: 230, g: 20, b: 30, a: 1 } }
const blue: Symbol = { type: 'circle', radius: 8, fill: { r: 20, g: 40, b: 230, a: 1 } }
const green: Symbol = { type: 'circle', radius: 7, fill: { r: 20, g: 180, b: 60, a: 1 } }
const fallback: Symbol = { type: 'circle', radius: 4, fill: { r: 100, g: 100, b: 100, a: 1 } }

function olFeature(geometry: Point | LineString | Polygon, properties: Record<string, unknown> = {}): Feature {
  return new Feature({ ...properties, geometry })
}

function oldPointColor(style: LayerStyle, properties: Record<string, unknown>): unknown {
  const feature = olFeature(new Point([0, 0]), properties)
  return compileStyle(style)(feature).getImage()?.getFill()?.getColor()
}

function matchesLayer(layer: StyleSpecification['layers'][number], feature: Feature): boolean {
  if (!layer.filter) return true
  const geometryType = feature.getGeometry()?.getType()
  const mapFeature = { type: geometryType === 'Point' ? 1 : geometryType === 'LineString' ? 2 : 3, properties: feature.getProperties() } as MapFeature
  return featureFilter(layer.filter, `layers.${layer.id}.filter`).filter({ zoom: 0 }, mapFeature)
}

function newPointColor(styleLayers: StyleSpecification['layers'], feature: Feature): string | undefined {
  const layer = styleLayers.find(item => item.type === 'circle' && matchesLayer(item, feature))
  const value = layer?.type === 'circle' ? layer.paint?.['circle-color'] : undefined
  return typeof value === 'string' ? value.replaceAll(/\s/g, '') : undefined
}

function renderedStylesAtZoom(styleLayers: StyleSpecification['layers'], sourceId: string, feature: Feature, zoom: number): ReturnType<ReturnType<typeof stylefunction>> {
  const style: StyleSpecification = { version: 8, sources: { [sourceId]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, layers: styleLayers }
  const layer = new VectorLayer({ source: new VectorSource() })
  const resolutions = Array.from({ length: 25 }, (_, index) => 2 ** -index)
  return stylefunction(layer, style, sourceId, resolutions)(feature, resolutions[zoom]!) ?? []
}

function renderedStyles(styleLayers: StyleSpecification['layers'], sourceId: string, feature: Feature) {
  return renderedStylesAtZoom(styleLayers, sourceId, feature, 3)
}

describe('MapLibre Style v8 cartography model', () => {
  it('uses deterministic IDs by GIS layer and dataset, independent of labels and display names', () => {
    expect(createCartographyState()).toEqual({ specVersion: 8, styleLayers: [], bindings: [] })
    const style: LayerStyle = { mode: 'single', symbol: red }
    const first = migrateLayerStyle(style, 'layer/一', 'roads')
    const renamed = migrateLayerStyle({ ...style, label: { field: 'name' } }, 'layer/一', 'roads')
    const sibling = migrateLayerStyle(style, 'layer-two', 'roads')
    expect(first.binding.styleSourceId).toBe(renamed.binding.styleSourceId)
    expect(first.binding.styleLayerIds).toEqual(migrateLayerStyle(style, 'layer/一', 'roads').binding.styleLayerIds)
    expect(new Set([...first.binding.styleLayerIds, ...sibling.binding.styleLayerIds]).size).toBe(first.binding.styleLayerIds.length + sibling.binding.styleLayerIds.length)
    expect(first.binding.styleSourceId).toBe(sibling.binding.styleSourceId)
  })

  it('assembles bottom-to-top order from GIS top-first input and uses empty shared GeoJSON sources', () => {
    const first = migrateLayerStyle({ mode: 'single', symbol: red }, 'top', 'same-data')
    const second = migrateLayerStyle({ mode: 'single', symbol: blue }, 'bottom', 'same-data')
    const state = { specVersion: 8 as const, styleLayers: [...first.styleLayers, ...second.styleLayers], bindings: [first.binding, second.binding] }
    const result = assembleCartographyStyle(state, ['top', 'unbound-wms', 'bottom'])
    expect(result.layers.map(layer => layer.id)).toEqual([...second.binding.styleLayerIds, ...first.binding.styleLayerIds])
    expect(Object.keys(result.sources)).toEqual([first.binding.styleSourceId])
    expect(result.sources[first.binding.styleSourceId]).toEqual({ type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    expect(result).not.toHaveProperty('source-layer')
  })

  it('creates standard geometry layers with transparent missing fills, round line joins, and px-to-width dash conversion', () => {
    const style: LayerStyle = { mode: 'single', symbol: { type: 'mixed', point: { type: 'circle', radius: 3, stroke: { r: 0, g: 0, b: 0, a: 1 } }, line: { type: 'solid', color: { r: 10, g: 20, b: 30, a: 1 }, width: 4, lineDash: [8, 4] }, polygon: { type: 'solid', fill: { r: 1, g: 2, b: 3, a: 0.5 }, stroke: { r: 4, g: 5, b: 6, a: 1 }, strokeWidth: 2 } } }
    const result = migrateLayerStyle(style, 'mixed', 'data')
    const point = result.styleLayers.find(layer => layer.type === 'circle')!
    const line = result.styleLayers.find(layer => layer.type === 'line')!
    const fill = result.styleLayers.find(layer => layer.type === 'fill')!
    const outline = result.styleLayers.find(layer => layer.type === 'line' && layer.id.includes('outline'))!
    expect(point.type === 'circle' && point.paint?.['circle-color']).toBe('rgba(0, 0, 0, 0)')
    expect(line.type === 'line' && line.paint?.['line-dasharray']).toEqual([2, 1])
    expect(line.type === 'line' && line.layout).toMatchObject({ 'line-cap': 'round', 'line-join': 'round' })
    expect(fill.type).toBe('fill')
    expect(outline.type).toBe('line')
    expect(validateStyleMin({ version: 8, sources: { [result.binding.styleSourceId]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, layers: result.styleLayers }).map(issue => issue.message)).toEqual([])
    const zeroWidth = migrateLayerStyle({ mode: 'single', symbol: { type: 'solid', color: { r: 1, g: 2, b: 3, a: 1 }, width: 0, lineDash: [2, 3] } }, 'zero', 'data')
    expect(zeroWidth.styleLayers[0]?.type === 'line' && zeroWidth.styleLayers[0].paint?.['line-dasharray']).toBeUndefined()
  })

  it('renders point, line, polygon, and mixed layers through the real OL stylefunction like the legacy compiler', () => {
    const mixed: LayerStyle = { mode: 'single', symbol: { type: 'mixed', point: red, line: { type: 'solid', color: { r: 15, g: 25, b: 35, a: 1 }, width: 4 }, polygon: { type: 'solid', fill: { r: 35, g: 45, b: 55, a: 0.5 }, stroke: { r: 65, g: 75, b: 85, a: 1 }, strokeWidth: 3 } } }
    const cases: Array<{ style: LayerStyle; geometry: Point | LineString | Polygon }> = [
      { style: { mode: 'single', symbol: { type: 'circle', radius: 5, fill: red.type === 'circle' ? red.fill : undefined } }, geometry: new Point([0, 0]) },
      { style: { mode: 'single', symbol: { type: 'solid', color: { r: 15, g: 25, b: 35, a: 1 }, width: 4, lineDash: [8, 4] } }, geometry: new LineString([[0, 0], [5, 5]]) },
      { style: { mode: 'single', symbol: { type: 'solid', fill: { r: 35, g: 45, b: 55, a: 0.5 }, stroke: { r: 65, g: 75, b: 85, a: 1 }, strokeWidth: 3, lineDash: [6, 3] } }, geometry: new Polygon([[[0, 0], [5, 0], [5, 5], [0, 0]]]) },
      { style: mixed, geometry: new Point([0, 0]) },
      { style: mixed, geometry: new LineString([[0, 0], [5, 5]]) },
      { style: mixed, geometry: new Polygon([[[0, 0], [5, 0], [5, 5], [0, 0]]]) }
    ]
    for (const [index, testCase] of cases.entries()) {
      const converted = migrateLayerStyle(testCase.style, `geometry-${index}`, 'shared')
      const feature = olFeature(testCase.geometry)
      const old = compileStyle(testCase.style)(feature)
      const current = renderedStyles(converted.styleLayers, converted.binding.styleSourceId, feature)
      const oldImage = old.getImage() as import('ol/style/Circle.js').default | null
      if (oldImage) expect(current.find(item => item.getImage())?.getImage()?.getFill()?.getColor()).toEqual(oldImage.getFill()?.getColor())
      if (old.getFill()) expect(current.find(item => item.getFill())?.getFill()?.getColor()).toEqual(old.getFill()?.getColor())
      if (old.getStroke()) {
        const oldStrokeColor = old.getStroke()?.getColor()
        const actual = current.find(item => item.getStroke()?.getColor() === oldStrokeColor)?.getStroke()
        expect(actual?.getColor()).toEqual(old.getStroke()?.getColor())
        expect(actual?.getWidth()).toBe(old.getStroke()?.getWidth())
        expect(actual?.getLineDash()).toEqual(old.getStroke()?.getLineDash())
        expect(actual?.getLineCap()).toBe(old.getStroke()?.getLineCap() ?? 'round')
        expect(actual?.getLineJoin()).toBe(old.getStroke()?.getLineJoin() ?? 'round')
      }
    }
  })

  it('matches OL category semantics by value type, last duplicate wins, and fallback is exclusive', () => {
    const style: LayerStyle = { mode: 'categorized', field: 'rank', categories: [
      { value: 1, symbol: red, label: '旧数字' }, { value: '1', symbol: green, label: '文本一' }, { value: 1, symbol: blue, label: '数字一' }
    ], fallback }
    const converted = migrateLayerStyle(style, 'category', 'data')
    expect((converted.styleLayers[0]?.metadata as Record<string, { classification?: unknown }> | undefined)?.['my-web-gis:cartography'].classification).toEqual({ mode: 'categorized', field: 'rank', value: 1 })
    for (const [value, expected] of [[1, 'rgba(20,40,230,1)'], ['1', 'rgba(20,180,60,1)'], [2, 'rgba(100,100,100,1)'], [undefined, 'rgba(100,100,100,1)']] as const) {
      const feature = olFeature(new Point([0, 0]), { rank: value })
      expect(newPointColor(converted.styleLayers, feature)).toBe(oldPointColor(style, { rank: value }).toString().replaceAll(/\s/g, ''))
      expect(newPointColor(converted.styleLayers, feature)).toBe(expected)
    }
    expect(converted.styleLayers.filter(layer => layer.type === 'circle').every(layer => layer.filter)).toBe(true)
    expect(buildCartographyLegendItems(converted.styleLayers).map(item => [item.label, item.color])).toEqual([
      ['旧数字', { r: 230, g: 20, b: 30, a: 1 }], ['文本一', { r: 20, g: 180, b: 60, a: 1 }],
      ['数字一', { r: 20, g: 40, b: 230, a: 1 }], ['其他', { r: 100, g: 100, b: 100, a: 1 }]
    ])
  })

  it('matches graduated <= ranges, exclusive middle bands, duplicate thresholds, overflow, missing, null, strings, and empty breaks to OL', () => {
    const style: LayerStyle = { mode: 'graduated', field: 'value', method: 'manual', breaks: [
      { value: 10, symbol: red, label: '低' }, { value: 10, symbol: blue, label: '重复' }, { value: 20, symbol: blue, label: '高' }
    ], fallback }
    const converted = migrateLayerStyle(style, 'graduated', 'data')
    expect((converted.styleLayers[0]?.metadata as Record<string, { classification?: unknown }> | undefined)?.['my-web-gis:cartography'].classification).toMatchObject({ mode: 'graduated', field: 'value', method: 'manual', value: 10 })
    for (const value of [0, 10, 10.01, 20, 999, null, '11', Number.POSITIVE_INFINITY, Number.NaN, undefined]) {
      const properties = value === undefined ? {} : { value }
      const actual = newPointColor(converted.styleLayers, olFeature(new Point([0, 0]), properties))
      expect(actual).toBe(oldPointColor(style, properties).toString().replaceAll(/\s/g, ''))
    }
    const noBreaks = migrateLayerStyle({ ...style, breaks: [] }, 'empty', 'data')
    expect(newPointColor(noBreaks.styleLayers, olFeature(new Point([0, 0]), { value: 10 }))).toBe(oldPointColor({ ...style, breaks: [] }, { value: 10 }).toString().replaceAll(/\s/g, ''))

    const threeBands: LayerStyle = { mode: 'graduated', field: 'value', method: 'manual', breaks: [
      { value: 10, symbol: red }, { value: 20, symbol: green }, { value: 30, symbol: blue }
    ], fallback }
    const bands = migrateLayerStyle(threeBands, 'three-bands', 'data')
    for (const value of [0, 10, 10.01, 20, 20.01, 30, 31, 999]) {
      const properties = { value }
      const feature = olFeature(new Point([0, 0]), properties)
      expect(newPointColor(bands.styleLayers, feature)).toBe(oldPointColor(threeBands, properties).toString().replaceAll(/\s/g, ''))
      expect(bands.styleLayers.filter(layer => layer.type === 'circle' && matchesLayer(layer, feature))).toHaveLength(1)
    }

    const duplicateTop: LayerStyle = { mode: 'graduated', field: 'value', method: 'manual', breaks: [
      { value: 10, symbol: red }, { value: 20, symbol: green }, { value: 20, symbol: blue }
    ], fallback }
    const duplicateTopLayers = migrateLayerStyle(duplicateTop, 'duplicate-top', 'data').styleLayers
    for (const value of [20, 20.1, 999]) {
      const properties = { value }
      expect(newPointColor(duplicateTopLayers, olFeature(new Point([0, 0]), properties))).toBe(oldPointColor(duplicateTop, properties).toString().replaceAll(/\s/g, ''))
    }
  })

  it('preserves scalar label values, OL pixel offsets, halo width, and OL-to-MapLibre zoom intent', () => {
    const migrated = migrateLayerStyle({ mode: 'single', symbol: red, label: { field: 'name', fontSize: 10, offsetX: 5, offsetY: -2, strokeWidth: 4, strokeColor: { r: 0, g: 0, b: 0, a: 1 }, minZoom: 3, maxZoom: 10 } }, 'labels', 'data')
    const label = migrated.styleLayers.find(layer => layer.type === 'symbol')!
    expect(label).toMatchObject({ minzoom: 2, maxzoom: 9 })
    expect(migrated.styleLayers.filter(layer => layer.id !== label.id).every(layer => layer.minzoom === undefined && layer.maxzoom === undefined)).toBe(true)
    expect(label.type === 'symbol' && label.layout).toMatchObject({ 'text-font': ['sans-serif'], 'text-size': 10, 'text-offset': [0.5, -0.2] })
    expect(label.type === 'symbol' && label.paint?.['text-halo-width']).toBe(2)
    const oldStyle = { mode: 'single' as const, symbol: red, label: { field: 'name' } }
    const falseFeature = olFeature(new Point([0, 0]), { name: false })
    expect(renderedStyles(migrated.styleLayers, migrated.binding.styleSourceId, falseFeature).find(item => item.getText())?.getText()?.getText()).toBe(compileStyle(oldStyle)(falseFeature).getText()?.getText())
    expect(renderedStyles(migrated.styleLayers, migrated.binding.styleSourceId, falseFeature).find(item => item.getText())?.getText()?.getText()).toBe('false')
    for (const value of ['River', 0, false]) {
      const feature = olFeature(new Point([0, 0]), { name: value })
      const currentText = renderedStyles(migrated.styleLayers, migrated.binding.styleSourceId, feature).find(item => item.getText())?.getText()?.getText()
      expect(currentText).toBe(compileStyle(oldStyle)(feature).getText()?.getText())
      expect(currentText).toBe(String(value))
    }
    for (const properties of [{ name: null }, { name: undefined }, { name: '' }]) {
      expect(renderedStyles(migrated.styleLayers, migrated.binding.styleSourceId, olFeature(new Point([0, 0]), properties)).some(item => item.getText())).toBe(false)
    }
    const objectFeature = olFeature(new Point([0, 0]), { name: { complex: true } })
    const arrayFeature = olFeature(new Point([0, 0]), { name: ['x', 'y'] })
    expect(renderedStyles(migrated.styleLayers, migrated.binding.styleSourceId, objectFeature).find(item => item.getText())?.getText()?.getText()).toBe('{"complex":true}')
    expect(renderedStyles(migrated.styleLayers, migrated.binding.styleSourceId, arrayFeature).find(item => item.getText())?.getText()?.getText()).toBe('["x","y"]')
    expect(migrated.diagnostics).toContain('label.field "name" 使用标准 to-string；数组/对象按 JSON 字符串化，与旧 JavaScript String(value) 不同。')
    expect((label.metadata as Record<string, { labelCoercion?: string }>)['my-web-gis:cartography']?.labelCoercion).toBe('maplibre-to-string-json-for-arrays-objects')
    const actualText = renderedStyles(migrated.styleLayers, migrated.binding.styleSourceId, falseFeature).find(item => item.getText())?.getText()
    const oldText = compileStyle({ mode: 'single', symbol: red, label: { field: 'name', fontSize: 10, offsetX: 5, offsetY: -2, strokeWidth: 4, strokeColor: { r: 0, g: 0, b: 0, a: 1 } } })(falseFeature).getText()
    expect(actualText?.getOffsetX()).toBe(oldText?.getOffsetX())
    expect(actualText?.getOffsetY()).toBe(oldText?.getOffsetY())
    expect(actualText?.getStroke()?.getWidth()).toBe(oldText?.getStroke()?.getWidth())
    expect(renderedStylesAtZoom(migrated.styleLayers, migrated.binding.styleSourceId, falseFeature, 1).some(item => item.getText())).toBe(false)
    expect(renderedStylesAtZoom(migrated.styleLayers, migrated.binding.styleSourceId, falseFeature, 9).some(item => item.getText())).toBe(false)
    expect(renderedStylesAtZoom(migrated.styleLayers, migrated.binding.styleSourceId, falseFeature, 2).some(item => item.getText())).toBe(true)
    expect(renderedStylesAtZoom(migrated.styleLayers, migrated.binding.styleSourceId, falseFeature, 1).some(item => item.getImage())).toBe(true)
    expect(renderedStylesAtZoom(migrated.styleLayers, migrated.binding.styleSourceId, falseFeature, 9).some(item => item.getImage())).toBe(true)
  })

  it('validates binding ownership and standard v8 while retaining legal expressions independent of editor metadata', () => {
    const migrated = migrateLayerStyle({ mode: 'single', symbol: red }, 'layer', 'dataset')
    const layer = migrated.styleLayers[0]!
    if (layer.type !== 'circle') throw new Error('预期 circle layer')
    layer.paint = { ...layer.paint, 'circle-color': ['case', ['==', ['get', 'kind'], 'a'], '#ff0000', '#0000ff'] }
    const state = { specVersion: 8, styleLayers: migrated.styleLayers, bindings: [migrated.binding] }
    expect(validateCartographyState(state)).toEqual([])
    expect(validateCartographyState({ ...state, bindings: [{ ...migrated.binding, styleLayerIds: [] }] })).toContain(`$.styleLayers[0].id ${layer.id} 没有 binding`)
    expect(validateCartographyState({ ...state, styleLayers: [{ ...layer, source: 'missing' }] }).some(message => message.includes('source'))).toBe(true)
    expect(validateCartographyState({ ...state, bindings: [migrated.binding, migrated.binding] }).some(message => message.includes('gisLayerId 重复'))).toBe(true)
    const sibling = migrateLayerStyle({ mode: 'single', symbol: blue }, 'sibling', 'dataset')
    expect(validateCartographyState({ specVersion: 8,
      styleLayers: [...migrated.styleLayers, ...sibling.styleLayers.map(layer => ({ ...layer, source: 'duplicate-source' }))],
      bindings: [migrated.binding, { ...sibling.binding, styleSourceId: 'duplicate-source' }],
    }).some(message => message.includes('必须共用同一个 styleSourceId'))).toBe(true)
    expect(validateCartographyState({ ...state, bindings: [{ ...migrated.binding, styleLayerIds: [layer.id, layer.id] }] }).some(message => message.includes('多个 binding'))).toBe(true)
    expect(validateCartographyState({ ...state, styleLayers: [{ ...layer, paint: { ...layer.paint, 'circle-radius': -1 } }] }).length).toBeGreaterThan(0)
    const assembled = assembleCartographyStyle(state, ['layer'])
    expect(assembled.layers[0]?.paint?.['circle-color']).toEqual(['case', ['==', ['get', 'kind'], 'a'], '#ff0000', '#0000ff'])
    const noMetadata = structuredClone(migrated.styleLayers)
    for (const candidate of noMetadata) delete candidate.metadata
    expect(noMetadata.map(candidate => ({ type: candidate.type, filter: candidate.filter, paint: candidate.paint, layout: candidate.layout }))).toEqual(migrated.styleLayers.map(candidate => ({ type: candidate.type, filter: candidate.filter, paint: candidate.paint, layout: candidate.layout })))
    const feature = olFeature(new Point([0, 0]), { kind: 'a' })
    expect(renderedStyles(noMetadata, migrated.binding.styleSourceId, feature).map(item => item.getImage()?.getFill()?.getColor())).toEqual(renderedStyles(migrated.styleLayers, migrated.binding.styleSourceId, feature).map(item => item.getImage()?.getFill()?.getColor()))
    expect(validateCartographyState({ ...state, styleLayers: [{ ...layer, paint: { ...layer.paint, 'circle-radius': Number.NaN } }] })).toContain('$.styleLayers[0].paint.circle-radius 必须是有限数值')
    expect(validateCartographyState({ ...state, styleLayers: [{ ...layer, layout: { 'visibility': undefined } }] })).toContain('$.styleLayers[0].layout.visibility 不是 JSON 值')
    const cyclic: Record<string, unknown> = { ...state }
    cyclic.self = cyclic
    expect(validateCartographyState(cyclic)).toContain('$.self 存在循环引用')
  })

  it('builds literal legends and explicitly rejects dynamic paint instead of inventing a swatch', () => {
    const migrated = migrateLayerStyle({ mode: 'single', symbol: { type: 'solid', fill: { r: 20, g: 40, b: 60, a: 1 }, stroke: { r: 1, g: 2, b: 3, a: 1 } } }, 'polygon', 'data')
    expect(buildCartographyLegendItems(migrated.styleLayers)).toEqual([{ label: '全部', kind: 'polygon', color: { r: 20, g: 40, b: 60, a: 1 } }])
    const dynamic = structuredClone(migrated.styleLayers)
    const fill = dynamic.find(layer => layer.type === 'fill')
    if (!fill || fill.type !== 'fill') throw new Error('预期 fill layer')
    fill.paint = { ...fill.paint, 'fill-color': ['get', 'color'] }
    expect(() => buildCartographyLegendItems(dynamic)).toThrow('动态或非字面符号')
    const graduated = migrateLayerStyle({ mode: 'graduated', field: 'v', method: 'manual', breaks: [
      { value: 20, symbol: blue }, { value: 10, symbol: red }
    ], fallback }, 'breaks', 'data')
    expect(buildCartographyLegendItems(graduated.styleLayers).map(item => item.label)).toEqual(['≤ 10', '10 < x ≤ 20', '其他'])
    const duplicateBreaks = migrateLayerStyle({ mode: 'graduated', field: 'v', method: 'manual', breaks: [
      { value: 20, symbol: blue }, { value: 10, symbol: red }, { value: 10, symbol: green }
    ], fallback }, 'duplicate-break-legend', 'data')
    expect(buildCartographyLegendItems(duplicateBreaks.styleLayers).map(item => item.label)).toEqual(['≤ 10', '10 < x ≤ 10', '10 < x ≤ 20', '其他'])
    const mixed: LayerStyle = { mode: 'single', symbol: { type: 'mixed', point: red, line: { type: 'solid', color: { r: 9, g: 8, b: 7, a: 1 }, width: 2 }, polygon: { type: 'solid', fill: { r: 3, g: 4, b: 5, a: 1 }, stroke: { r: 6, g: 7, b: 8, a: 1 }, strokeWidth: 1 } } }
    expect(buildCartographyLegendItems(migrateLayerStyle(mixed, 'mixed-legend', 'data').styleLayers)).toEqual([{ label: '全部', kind: 'polygon', color: { r: 3, g: 4, b: 5, a: 1 } }])
  })
})
