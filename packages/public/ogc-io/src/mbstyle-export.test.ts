import { describe, expect, it } from 'vitest'
import { validateStyleMin, type LayerSpecification, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { exportMbStyle, fingerprintMbStyle } from './mbstyle-export.js'

const line = {
  id: 'road-main', source: 'local-source', type: 'line',
  filter: ['all', ['==', ['get', 'class'], 'primary'], ['has', 'name']],
  paint: { 'line-color': '#bf3b27', 'line-width': 2.5, 'line-dasharray': [2, 1] },
  layout: { 'line-cap': 'round', visibility: 'visible' },
  metadata: { 'cartography:binding': 'local-only' }
} as unknown as LayerSpecification

describe('conservative GeoServer MBStyle export', () => {
  it('retains standard line/filter semantics and reports source/metadata adaptation', async () => {
    const result = await exportMbStyle([line], { name: 'roads' })
    expect(result.publishable).toBe(true)
    expect(result.level).toBe('approximated')
    expect(result.issues.map(issue => issue.path)).toEqual(['/layers/0/source', '/layers/0/metadata'])
    const document = JSON.parse(result.json!)
    expect(document).toEqual({
      version: 8,
      name: 'roads',
      layers: [{
        id: 'road-main', type: 'line',
        filter: ['all', ['==', ['get', 'class'], 'primary'], ['has', 'name']],
        layout: { 'line-cap': 'round', visibility: 'visible' },
        paint: { 'line-color': '#bf3b27', 'line-width': 2.5, 'line-dasharray': [2, 1] }
      }]
    })
    const source = { __target: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }
    const normalizedLayers = document.layers.map((item: Record<string, unknown>) => ({ ...item, source: '__target' }))
    expect(validateStyleMin({ version: 8, sources: source, layers: normalizedLayers } as StyleSpecification)).toEqual([])
  })

  it('rejects assets, unknown paint properties and dynamic expressions in strict mode', async () => {
    const result = await exportMbStyle([{
      ...line,
      paint: { ...line.paint, 'line-width': ['get', 'width'], 'line-pattern': 'road-texture', 'line-translate': [1, 2] }
    } as unknown as LayerSpecification], { name: 'roads', strict: true })
    expect(result).toMatchObject({ publishable: false, level: 'unsupported' })
    expect(result.json).toBeUndefined()
    expect(result.issues.map(issue => issue.path)).toEqual([
      '/layers/0/source', '/layers/0/metadata', '/layers/0/paint/line-width', '/layers/0/paint/line-pattern', '/layers/0/paint/line-translate'
    ])
  })

  it('does not silently drop source-layer, unsupported geometry families or zoom adaptation', async () => {
    const result = await exportMbStyle([
      { ...line, 'source-layer': 'roads' } as unknown as LayerSpecification,
      { id: 'raster', type: 'raster', source: 'raster-source' } as unknown as LayerSpecification,
      { ...line, id: 'zoomed', minzoom: 5, maxzoom: 11 } as LayerSpecification
    ], { name: 'roads', strict: true })
    expect(result.publishable).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/layers/0/source-layer', level: 'unsupported' }),
      expect.objectContaining({ path: '/layers/1/type', level: 'unsupported' }),
      expect.objectContaining({ path: '/layers/2/minzoom', level: 'approximated' }),
      expect.objectContaining({ path: '/layers/2/maxzoom', level: 'approximated' })
    ]))
  })

  it('preserves migrated geometry-type guards for simple point and line symbols', async () => {
    const layers = [
      { id: 'legacy-point', type: 'circle', source: 'source', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#123456', 'circle-radius': 5 } },
      { id: 'legacy-line', type: 'line', source: 'source', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#654321', 'line-width': 2 } }
    ] as unknown as LayerSpecification[]
    const result = await exportMbStyle(layers, { name: 'legacy-default', strict: true })
    expect(result.publishable).toBe(true)
    expect(JSON.parse(result.json!).layers.map((layer: Record<string, unknown>) => layer.filter)).toEqual([
      ['==', ['geometry-type'], 'Point'],
      ['==', ['geometry-type'], 'LineString']
    ])
    expect(result.issues.filter(issue => issue.level === 'unsupported')).toEqual([])
  })

  it('fingerprints JSON independent of object-key order but keeps layer order significant', async () => {
    const first = '{"version":8,"name":"roads","layers":[{"id":"a","type":"line","paint":{"line-width":2,"line-color":"red"}}]}'
    const reorderedKeys = '{"layers":[{"paint":{"line-color":"red","line-width":2},"type":"line","id":"a"}],"name":"roads","version":8}'
    const reversedLayers = '{"version":8,"name":"roads","layers":[{"id":"b","type":"line"},{"id":"a","type":"line"}]}'
    expect(await fingerprintMbStyle(first)).toBe(await fingerprintMbStyle(reorderedKeys))
    expect(await fingerprintMbStyle(first)).not.toBe(await fingerprintMbStyle(reversedLayers))
    await expect(fingerprintMbStyle('{"version":7,"layers":[]}')).rejects.toThrow()
  })

  it('rejects deeply nested remote JSON before recursive normalization overflows', async () => {
    let nested: unknown = null
    for (let index = 0; index < 110; index++) nested = [nested]
    await expect(fingerprintMbStyle(JSON.stringify({ version: 8, layers: [], metadata: nested }))).rejects.toThrow('结构过深')
  })
})
