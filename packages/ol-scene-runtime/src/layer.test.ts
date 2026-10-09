import { describe, expect, it, vi } from 'vitest'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import LayerGroup from 'ol/layer/Group.js'
import VectorLayer from 'ol/layer/Vector.js'
import XYZ from 'ol/source/XYZ.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import { createOlSceneLayer, createOlVectorLayer, SCENE_LAYER_ID } from './index.js'

describe('scene layer adapter', () => {
  const view = new View({ projection: 'EPSG:3857', center: [0, 0], zoom: 2 })

  it('creates editor and document layers around the same caller-owned feature identities', async () => {
    const feature = new Feature(new Point([1, 2])); feature.setId('host-id')
    const source = new VectorSource({ features: [feature] })
    const definition = { type: 'vector' as const, id: 'points', name: 'Points', source: 'data', visible: false, opacity: .4,
      style: { mode: 'single' as const, symbol: { type: 'circle' as const, radius: 6 } } }
    const editor = createOlVectorLayer(definition, source)
    const viewer = await createOlSceneLayer(definition, { data: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } }, view, { vectorSource: source }) as VectorLayer
    expect(editor.getSource()).toBe(source); expect(viewer.getSource()).toBe(source)
    expect(editor.get(SCENE_LAYER_ID)).toBe('points'); expect(editor.getVisible()).toBe(false); expect(editor.getOpacity()).toBe(.4)
    editor.dispose(); viewer.dispose()
    expect(source.getFeatureById('host-id')).toBe(feature)
    source.dispose()
  })

  it('creates XYZ layers without exposing OpenLayers in the scene definition', async () => {
    const layer = await createOlSceneLayer(
      {
        id: 'base',
        type: 'tile',
        name: 'Base',
        source: 'base',
        visible: false,
        opacity: 0.5
      },
      { base: { type: 'xyz', url: 'https://example.com/{z}/{x}/{y}.png' } },
      view
    )

    expect(layer).toBeInstanceOf(TileLayer)
    expect(layer.get(SCENE_LAYER_ID)).toBe('base')
    expect(layer.getVisible()).toBe(false)
    expect(layer.getOpacity()).toBe(0.5)
  })

  it('maps one logical Tianditu basemap to a grouped base and label layer', async () => {
    const layer = await createOlSceneLayer(
      {
        id: 'tianditu',
        type: 'tile',
        name: 'Tianditu imagery',
        source: 'tianditu'
      },
      {
        tianditu: {
          type: 'provider',
          provider: 'tianditu',
          mapType: 'imagery',
          withLabels: true,
          credential: 'tianditu'
        }
      },
      view,
      { credentials: { tianditu: 'test-token' } }
    )

    expect(layer).toBeInstanceOf(LayerGroup)
    expect((layer as LayerGroup).getLayers().getLength()).toBe(2)
    expect(layer.get(SCENE_LAYER_ID)).toBe('tianditu')
  })

  it('supports Tianditu EPSG:4326 with the c matrix set and level offset', async () => {
    const geographicView = new View({ projection: 'EPSG:4326', center: [116.4, 39.9], zoom: 2 })
    const layer = await createOlSceneLayer(
      { id: 'tianditu-4326', type: 'tile', name: 'Tianditu', source: 'tianditu' },
      {
        tianditu: {
          type: 'provider',
          provider: 'tianditu',
          mapType: 'vector',
          projection: 'EPSG:4326',
          withLabels: false,
          credential: 'tianditu'
        }
      },
      geographicView,
      { credentials: { tianditu: 'test-token' } }
    )

    const source = ((layer as LayerGroup).getLayers().item(0) as TileLayer<XYZ>).getSource()
    const url = source?.getTileUrlFunction()([0, 0, 0], 1, geographicView.getProjection())
    expect(url).toContain('/vec_c/wmts')
    expect(url).toContain('TILEMATRIX=1')
    expect(url).toContain('TILECOL=0')
    expect(url).toContain('TILEROW=0')
  })

  it('creates a Google Map Tiles session before creating its tile layer', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          session: 'session-token',
          expiry: '2099-01-01T00:00:00Z',
          tileWidth: 256,
          tileHeight: 256,
          imageFormat: 'png'
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    ) as unknown as typeof globalThis.fetch
    const layer = await createOlSceneLayer(
      { id: 'google', type: 'tile', name: 'Google', source: 'google' },
      {
        google: {
          type: 'provider',
          provider: 'google-map-tiles',
          mapType: 'roadmap',
          language: 'zh-CN',
          region: 'CN',
          credential: 'google'
        }
      },
      view,
      { credentials: { google: 'api-key' }, fetch: fetcher }
    )

    expect(fetcher).toHaveBeenCalledOnce()
    const [requestUrl, init] = vi.mocked(fetcher).mock.calls[0] ?? []
    expect(String(requestUrl)).toContain('/v1/createSession?key=api-key')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBe(JSON.stringify({ mapType: 'roadmap', language: 'zh-CN', region: 'CN' }))
    const tileSource = (layer as TileLayer<XYZ>).getSource()
    const tileUrl = tileSource?.getTileUrlFunction()([2, 1, 1], 1, view.getProjection())
    expect(tileUrl).toContain('/v1/2dtiles/2/1/1?session=session-token&key=api-key')
  })

  it('creates vector layers from inline GeoJSON and assigns stable IDs from an id field', async () => {
    const layer = await createOlSceneLayer(
      {
        id: 'places',
        type: 'vector',
        name: 'Places',
        source: 'places',
        style: {
          mode: 'single',
          symbol: { type: 'circle', radius: 6, fill: { r: 37, g: 99, b: 235, a: 1 } }
        }
      },
      {
        places: {
          type: 'geojson',
          idField: 'code',
          data: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [116.4, 39.9] },
                properties: { code: 'beijing', name: 'Beijing' }
              }
            ]
          }
        }
      },
      view
    )

    expect(layer).toBeInstanceOf(VectorLayer)
    const vectorLayer = layer as VectorLayer
    expect(vectorLayer.getSource()?.getFeatures()).toHaveLength(1)
    expect(vectorLayer.getSource()?.getFeatures()[0]?.getId()).toBe('beijing')
  })
})
