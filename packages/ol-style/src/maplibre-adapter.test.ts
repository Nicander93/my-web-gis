import Feature from 'ol/Feature.js'
import LineString from 'ol/geom/LineString.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Style from 'ol/style/Style.js'
import { describe, expect, it } from 'vitest'
import { createMapLibreCanvasBinding, validateMapLibreStyle } from './cartography.js'
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'

const style: StyleSpecification = {
  version: 8,
  sources: { roads: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
  layers: [
    { id: 'roads', type: 'line', source: 'roads', paint: { 'line-color': ['match', ['get', 'kind'], 'major', '#c00', '#06c'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 16, 10] } },
  ],
}

describe('MapLibre Canvas adapter spike', () => {
  it('validates standard v8 styles and rejects invalid expressions', () => {
    expect(validateMapLibreStyle(style)).toEqual([])
    expect(validateMapLibreStyle({ ...style, version: 7 } as unknown as StyleSpecification)).not.toEqual([])
    const invalid = {
      ...style,
      layers: [{ id: 'invalid', type: 'line', source: 'roads', paint: { 'line-width': ['not-a-style-operator', 1] } }],
    } as unknown as StyleSpecification
    expect(validateMapLibreStyle(invalid).join('; ')).toContain('line-width')
  })

  it('applies stylefunction at MapLibre zoom levels and keeps the existing source and features', async () => {
    const feature = new Feature({ geometry: new LineString([[0, 0], [100, 0]]), kind: 'major' })
    const source = new VectorSource({ features: [feature] })
    const originalStyle = new Style()
    const layer = new VectorLayer({ source, style: originalStyle })
    const binding = createMapLibreCanvasBinding(layer, { sourceId: 'roads' })
    const originalDocument = structuredClone(style)

    await expect(binding.update({ ...style, version: 7 } as unknown as StyleSpecification)).rejects.toThrow('校验失败')
    expect(layer.getSource()).toBe(source)
    expect(layer.getStyle()).toBe(originalStyle)

    await expect(binding.update(style)).resolves.toBe(true)
    expect(style).toEqual(originalDocument)
    expect(layer.getSource()).toBe(source)
    expect(source.getFeatures()[0]).toBe(feature)
    expect(layer.get('mapbox-layers')).toEqual(['roads'])

    const styleFunction = layer.getStyleFunction()
    expect(styleFunction).toBeDefined()
    const lowZoomResolution = 156543.03392804097 / 2 ** (8 + 1)
    const highZoomResolution = 156543.03392804097 / 2 ** (16 + 1)
    const lowZoomWidth = styleFunction?.(feature, lowZoomResolution)?.[0].getStroke()?.getWidth()
    const highZoomWidth = styleFunction?.(feature, highZoomResolution)?.[0].getStroke()?.getWidth()

    expect(lowZoomWidth).toBeCloseTo(2)
    expect(highZoomWidth).toBeCloseTo(10)
  })

  it('recompiles visibility and filters with stable layer IDs without reusing private expression caches', async () => {
    const feature = new Feature({ geometry: new LineString([[0, 0], [100, 0]]), kind: 'major' })
    const layer = new VectorLayer({ source: new VectorSource({ features: [feature] }) })
    const binding = createMapLibreCanvasBinding(layer, { sourceId: 'roads' })
    await binding.update(style)
    const hidden = structuredClone(style)
    hidden.layers[0].layout = { visibility: 'none' }
    await binding.update(hidden)
    expect(layer.getStyleFunction()?.(feature, 100)).toBeUndefined()

    const filtered = structuredClone(style)
    const filteredLine = filtered.layers.find(layer => layer.type === 'line')
    if (!filteredLine || filteredLine.type !== 'line') throw new Error('Missing line fixture')
    filteredLine.filter = ['==', ['get', 'kind'], 'local']
    await binding.update(filtered)
    expect(layer.getStyleFunction()?.(feature, 100)).toBeUndefined()
    await binding.update(style)
    expect(layer.getStyleFunction()?.(feature, 100)?.length).toBeGreaterThan(0)
  })

  it('renders only the selected style-layer subset for shared sources and rejects invalid bindings', async () => {
    const feature = new Feature({ geometry: new LineString([[0, 0], [100, 0]]) })
    const source = new VectorSource({ features: [feature] })
    const layer = new VectorLayer({ source })
    const sharedStyle: StyleSpecification = {
      version: 8,
      sources: { roads: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [
        { id: 'subset-a', type: 'line', source: 'roads', paint: { 'line-color': '#f00', 'line-width': 3 } },
        { id: 'subset-b', type: 'line', source: 'roads', paint: { 'line-color': '#00f', 'line-width': 9 } }
      ]
    }
    const binding = createMapLibreCanvasBinding(layer, { sourceId: 'roads', layerIds: ['subset-b'] })
    await expect(binding.update(sharedStyle)).resolves.toBe(true)
    expect(layer.get('mapbox-layers')).toEqual(['subset-b'])
    expect(layer.getSource()).toBe(source)
    expect(source.getFeatures()[0]).toBe(feature)
    const selected = layer.getStyleFunction()?.(feature, 100)
    expect(selected).toHaveLength(1)
    expect(selected?.[0]?.getStroke()?.getWidth()).toBe(9)

    const missingId = createMapLibreCanvasBinding(layer, { sourceId: 'roads', layerIds: ['not-present'] })
    await expect(missingId.update(sharedStyle)).rejects.toThrow('Style Layer 不存在')
    const wrongSourceStyle: StyleSpecification = {
      ...sharedStyle,
      sources: { ...sharedStyle.sources, water: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [{ id: 'water-layer', type: 'line', source: 'water', paint: { 'line-color': '#0f0', 'line-width': 1 } }]
    }
    const wrongSource = createMapLibreCanvasBinding(layer, { sourceId: 'roads', layerIds: ['water-layer'] })
    await expect(wrongSource.update(wrongSourceStyle)).rejects.toThrow('Style Layer 不存在或 source 不一致')
    const absentSource = createMapLibreCanvasBinding(layer, { sourceId: 'missing' })
    await expect(absentSource.update(sharedStyle)).rejects.toThrow('需要 GeoJSON source')

    const empty = createMapLibreCanvasBinding(layer, { sourceId: 'roads', layerIds: [] })
    await expect(empty.update(sharedStyle)).resolves.toBe(true)
    expect(layer.getStyleFunction()?.(feature, 100)).toBeUndefined()
  })
})
