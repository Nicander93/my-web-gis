import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { createExpression, type LayerSpecification } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'
import { exportSld } from './sld-export.js'
import { migrateLayerStyle } from '@desktop-webgis/ol-style/cartography-model'

const context = { targetLayerName: 'roads & routes', crs: 'EPSG:3857' }

function parse(xml: string): Document {
  const errors: string[] = []
  const document = new DOMParser({ onError: (_level, message) => errors.push(message) }).parseFromString(xml, 'application/xml')
  expect(errors).toEqual([])
  expect(document.documentElement.localName).toBe('StyledLayerDescriptor')
  return document
}

function nodes(document: Document, namespace: string, name: string): Element[] {
  return Array.from(document.getElementsByTagNameNS(namespace, name))
}

describe('MapLibre Style Layer to SLD 1.0 export', () => {
  it('converts legacy field comparisons before exporting filters', () => {
    const result = exportSld([{ id: 'legacy', type: 'line', source: 's', filter: ['==', 'class', 'primary'] }], { ...context, strict: true })
    expect(result.publishable, JSON.stringify(result.issues)).toBe(true)
    expect(result.sldXml).toContain('<ogc:PropertyName>class</ogc:PropertyName>')
    expect(result.sldXml).not.toContain('<ogc:Literal>class</ogc:Literal>')
    const membership = exportSld([{ id: 'legacy', type: 'line', source: 's', filter: ['in', 'class', 'primary', 'secondary'] }], { ...context, strict: true })
    // Membership needs a dedicated mapping; never emit an incorrect constant comparison.
    expect(membership.publishable).toBe(false)
  })
  it('preserves migrated geometry/type guards and categorization when the actual target schema is known', () => {
    const line = { type: 'solid' as const, color: { r: 255, g: 0, b: 0, a: 1 }, width: 3 }
    const migrated = migrateLayerStyle({ mode: 'categorized', field: 'kind', categories: [{ value: 'primary', symbol: line }], fallback: line }, 'road', 'roads')
    const result = exportSld(migrated.styleLayers, { ...context, geometryField: 'geom', fieldTypes: { kind: 'string' }, strict: true })
    expect(result.publishable, JSON.stringify(result.issues)).toBe(true)
    expect(result.sldXml).toContain('geometryType')
    expect(result.sldXml).toContain('MultiLineString')
    expect(result.sldXml).toContain('<ogc:PropertyIsNull>')
    expect(exportSld(migrated.styleLayers, { ...context, geometryField: 'geom', strict: true }).publishable).toBe(false)
  })
  it('converts dash multiples to pixels and emits Halo radius before fill', () => {
    const result = exportSld([
      { id: 'road', source: 's', type: 'line', paint: { 'line-width': 4, 'line-dasharray': [3, 2] } },
      { id: 'label', source: 's', type: 'symbol', layout: { 'text-field': 'Road' }, paint: { 'text-halo-width': 2, 'text-halo-color': '#fff' } },
    ], context)
    expect(result.sldXml).toContain('name="stroke-dasharray">12 8')
    expect(result.sldXml).toContain('<sld:Halo><sld:Radius>2</sld:Radius><sld:Fill>')
  })
  it('creates parseable line, circle, polygon, and text symbolizers with escaped labels and fields', () => {
    const layers: LayerSpecification[] = [
      { id: 'roads', source: 'source', type: 'line', paint: { 'line-color': '#123456', 'line-width': 2.5, 'line-dasharray': [2, 1] } },
      { id: 'places', source: 'source', type: 'circle', paint: { 'circle-color': '#ff0000', 'circle-radius': 5, 'circle-stroke-color': '#000000', 'circle-stroke-width': 1 } },
      { id: 'water', source: 'source', type: 'fill', paint: { 'fill-color': 'rgba(10, 20, 30, 0.5)', 'fill-opacity': 0.8, 'fill-outline-color': '#010203' } },
      {
        id: 'labels', source: 'source', type: 'symbol',
        layout: { 'text-field': ['get', 'label<&'], 'text-font': ['Noto Sans Regular'], 'text-size': 14, 'text-anchor': 'top-left', 'text-offset': [0.5, 1] },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#222222', 'text-halo-width': 1.5 }
      }
    ]

    const result = exportSld(layers, context)
    expect(result.level, JSON.stringify(result.issues)).toBe('approximated')
    expect(result.publishable).toBe(true)
    expect(result.issues.map(issue => issue.path)).toContain('/layers/labels/layout/text-offset')
    const document = parse(result.sldXml!)
    const serialized = new XMLSerializer().serializeToString(document)
    expect(parse(serialized).documentElement.localName).toBe('StyledLayerDescriptor')
    expect(nodes(document, 'http://www.opengis.net/sld', 'LineSymbolizer')).toHaveLength(1)
    expect(nodes(document, 'http://www.opengis.net/sld', 'PointSymbolizer')).toHaveLength(1)
    expect(nodes(document, 'http://www.opengis.net/sld', 'PolygonSymbolizer')).toHaveLength(1)
    expect(nodes(document, 'http://www.opengis.net/sld', 'TextSymbolizer')).toHaveLength(1)
    expect(nodes(document, 'http://www.opengis.net/ogc', 'PropertyName')[0]?.textContent).toBe('label<&')
    expect(nodes(document, 'http://www.opengis.net/sld', 'Name')[0]?.textContent).toBe('roads & routes')
  })

  it('turns match and step paint expressions into ordered SLD rules and typed filters', () => {
    const layers: LayerSpecification[] = [
      {
        id: 'classified-roads', source: 'source', type: 'line',
        filter: ['all', ['>=', ['get', 'rank'], 3], ['==', ['get', 'label'], 'A&B']],
        paint: {
          'line-color': ['match', ['get', 'kind'], 'primary', '#ff0000', 'secondary', '#00ff00', '#999999'],
          'line-width': 2
        }
      },
      {
        id: 'ranked-polygons', source: 'source', type: 'fill',
        paint: { 'fill-color': ['step', ['get', 'rank'], '#ffffff', 2, '#ff0000', 5, '#00ff00'] }
      }
    ]

    const document = parse(exportSld(layers, context).sldXml!)
    expect(nodes(document, 'http://www.opengis.net/sld', 'FeatureTypeStyle')).toHaveLength(2)
    expect(nodes(document, 'http://www.opengis.net/sld', 'Rule')).toHaveLength(6)
    expect(nodes(document, 'http://www.opengis.net/ogc', 'PropertyIsGreaterThanOrEqualTo')).toHaveLength(5)
    expect(nodes(document, 'http://www.opengis.net/ogc', 'Literal').some(node => node.textContent === 'A&B')).toBe(true)
  })

  it('reports null-check approximation even when nested inside logical filters', () => {
    const layer: LayerSpecification = {
      id: 'roads', source: 'source', type: 'line',
      filter: ['all', ['has', 'name'], ['>', ['get', 'rank'], 2]], paint: { 'line-width': 2 }
    }
    const result = exportSld([layer], context)
    expect(result.level).toBe('approximated')
    expect(result.issues).toContainEqual(expect.objectContaining({ path: '/layers/roads/filter', level: 'approximated' }))
    expect(parse(result.sldXml!).documentElement.localName).toBe('StyledLayerDescriptor')
  })

  it('maps zoom bounds with the 512px world scale and latitude adjustment', () => {
    const layer: LayerSpecification = { id: 'zoomed', source: 'source', type: 'line', minzoom: 5, maxzoom: 10, paint: { 'line-width': 2 } }
    const equator = parse(exportSld([layer], context).sldXml!)
    const north = parse(exportSld([layer], { ...context, zoomResolutionMapping: { referenceLatitude: 60 } }).sldXml!)
    const read = (doc: Document, name: string) => Number(nodes(doc, 'http://www.opengis.net/sld', name)[0]?.textContent)
    const minScale = read(equator, 'MinScaleDenominator')
    const maxScale = read(equator, 'MaxScaleDenominator')
    expect(minScale).toBeGreaterThan(0)
    expect(maxScale).toBeGreaterThan(minScale)
    expect(read(north, 'MinScaleDenominator')).toBeCloseTo(minScale / 2, 3)
    expect(read(north, 'MaxScaleDenominator')).toBeCloseTo(maxScale / 2, 3)
  })

  it('writes a field-scaled line width as an OGC expression rather than an escaped fixed value', () => {
    const layer: LayerSpecification = {
      id: 'roads', source: 'source', type: 'line',
      paint: { 'line-width': ['*', ['number', ['get', 'lanes'], 0], 1.5] }
    }
    const document = parse(exportSld([layer], { ...context, fieldTypes: { lanes: 'number' } }).sldXml!)
    const width = nodes(document, 'http://www.opengis.net/sld', 'CssParameter').find(node => node.getAttribute('name') === 'stroke-width')
    expect(width?.getElementsByTagNameNS('http://www.opengis.net/ogc', 'Mul').length).toBe(1)
    expect(nodes(document, 'http://www.opengis.net/ogc', 'PropertyName').some(node => node.textContent === 'lanes')).toBe(true)
    expect(nodes(document, 'http://www.opengis.net/ogc', 'Literal').some(node => node.textContent === '1.5')).toBe(true)
    expect(nodes(document, 'http://www.opengis.net/ogc', 'Function').map(node => node.getAttribute('name'))).toEqual(['if_then_else', 'isNull'])
    expect(exportSld([layer], { ...context, strict: true }).publishable).toBe(false)
  })

  it('reports data-driven circle strokes as unsupported instead of silently dropping them', () => {
    const result = exportSld([{ id: 'point', source: 's', type: 'circle', paint: { 'circle-stroke-width': ['get', 'width'], 'circle-stroke-color': '#ff0000' } }], { ...context, strict: true })
    expect(result.publishable).toBe(false)
    expect(result.sldXml).toBeUndefined()
    expect(result.issues.some(issue => issue.path.endsWith('/circle-stroke-width'))).toBe(true)
  })

  it('requires an explicit preview zoom for continuous zoom styling and strict mode omits unsupported XML', () => {
    const layer: LayerSpecification = {
      id: 'roads', source: 'source', type: 'line',
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 12, 9] }
    }
    const strict = exportSld([layer], { ...context, strict: true })
    expect(strict.level).toBe('unsupported')
    expect(strict.sldXml).toBeUndefined()
    expect(strict.publishable).toBe(false)
    expect(strict.issues).toContainEqual(expect.objectContaining({ path: '/layers/roads/paint/line-width', level: 'unsupported' }))

    const preview = exportSld([layer], { ...context, previewZoom: 8 })
    expect(preview.level).toBe('approximated')
    expect(preview.publishable).toBe(true)
    const document = parse(preview.sldXml!)
    const exportedWidth = Number(nodes(document, 'http://www.opengis.net/sld', 'CssParameter').find(node => node.getAttribute('name') === 'stroke-width')?.textContent)
    const evaluated = createExpression(layer.paint!['line-width'], 'paint.line-width')
    expect(evaluated.result).toBe('success')
    if (evaluated.result === 'success') expect(exportedWidth).toBe(evaluated.value.evaluate({ zoom: 8 }))
  })

  it('reports unknown filters and style properties by path instead of silently exporting them', () => {
    const layer: LayerSpecification = {
      id: 'roads', source: 'source', type: 'line', filter: ['in', ['get', 'kind'], ['literal', ['a', 'b']]],
      paint: { 'line-color': '#ff0000', 'line-blur': 2 }
    }
    const result = exportSld([layer], { ...context, strict: true })
    expect(result.sldXml).toBeUndefined()
    expect(result.publishable).toBe(false)
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/layers/roads/filter', level: 'unsupported' }),
      expect.objectContaining({ path: '/layers/roads/paint/line-blur', level: 'unsupported' })
    ]))
  })

  it('exports only matched embedded assets as deterministic relative paths with original bytes and attribution', () => {
    const hash = 'a'.repeat(64)
    const asset = {
      id: 'marker-id', name: 'marker', mimeType: 'image/png', contentHash: hash, width: 24, height: 24,
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=', attribution: { source: 'Survey Office', license: 'CC BY 4.0' }
    }
    const layer: LayerSpecification = { id: 'markers', source: 'source', type: 'symbol', layout: { 'icon-image': 'marker-id' } }
    const result = exportSld([layer], { ...context, assets: [asset] })
    expect(result.assets).toEqual([{ path: `${hash}.png`, mimeType: 'image/png', contentHash: hash, attribution: asset.attribution, dataUrl: asset.dataUrl }])
    const document = parse(result.sldXml!)
    const href = nodes(document, 'http://www.opengis.net/sld', 'OnlineResource')[0]?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    expect(href).toBe(`${hash}.png`)
    expect(nodes(document, 'http://www.opengis.net/sld', 'Size')[0]?.textContent).toBe('24')

    const remote = exportSld([layer], context)
    expect(remote.assets).toEqual([])
    expect(remote.level).toBe('unsupported')
    expect(remote.issues[0]?.reason).toContain('不會輸出臨時或公網 URL')
  })
})
