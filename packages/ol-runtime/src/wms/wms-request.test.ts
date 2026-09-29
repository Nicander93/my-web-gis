import { describe, expect, it } from 'vitest'
import { buildGetMapUrl } from './getMapRequest'
import { createWmsTileLayer, refreshWmsTileLayer } from './createWmsLayer'
import type { WmsDataset } from '@desktop-webgis/gis-core'

describe('WMS GetMap URL + axis order (via OL helpers)', () => {
  const extent4326: [number, number, number, number] = [-10, 40, 10, 60]

  it('WMS 1.3.0 + EPSG:4326 swaps BBOX to lat,lon (ne axis)', () => {
    const result = buildGetMapUrl({
      url: 'https://example.com/wms',
      version: '1.3.0',
      layers: 'cities',
      styles: 'default',
      crs: 'EPSG:4326',
      extent: extent4326,
      width: 256,
      height: 256
    })
    expect(result.version).toBe('1.3.0')
    expect(result.crsParam).toBe('CRS')
    expect(result.crsValue).toBe('EPSG:4326')
    // OL swaps when axis orientation starts with "ne"
    expect(result.bbox).toBe('40,-10,60,10')
    expect(result.url).toContain('REQUEST=GetMap')
    expect(result.url).toContain('LAYERS=cities')
    expect(result.url).toMatch(/CRS=EPSG%3A4326|CRS=EPSG:4326/)
  })

  it('WMS 1.1.1 + EPSG:4326 keeps lon,lat BBOX and uses SRS', () => {
    const result = buildGetMapUrl({
      url: 'https://example.com/wms',
      version: '1.1.1',
      layers: 'dem',
      crs: 'EPSG:4326',
      extent: extent4326,
      width: 128,
      height: 128
    })
    expect(result.version).toBe('1.1.1')
    expect(result.crsParam).toBe('SRS')
    expect(result.bbox).toBe('-10,40,10,60')
    expect(result.url).toContain('WIDTH=128')
    expect(result.url).toContain('HEIGHT=128')
  })

  it('WMS 1.3.0 + EPSG:3857 keeps projected XY order', () => {
    const extent3857: [number, number, number, number] = [-20037508, -20037508, 20037508, 20037508]
    const result = buildGetMapUrl({
      url: 'https://example.com/wms',
      version: '1.3.0',
      layers: 'world',
      crs: 'EPSG:3857',
      extent: extent3857,
      width: 256,
      height: 256
    })
    expect(result.crsParam).toBe('CRS')
    expect(result.bbox).toBe(extent3857.join(','))
  })
})

describe('createWmsTileLayer', () => {
  const dataset: WmsDataset = {
    id: 'ds-wms-1',
    name: 'Cities',
    kind: 'wms',
    source: {
      type: 'wms',
      url: 'https://example.com/wms?map=/data',
      version: '1.3.0',
      layerNames: ['cities'],
      styleNames: ['outline'],
      format: 'image/png',
      transparent: true,
      crs: 'EPSG:3857',
      bboxWgs84: [-10, 40, 10, 60],
      authMode: 'none'
    }
  }

  it('wires TileWMS params from Dataset and stores extent for zoom', () => {
    const layer = createWmsTileLayer({
      layerId: 'layer-1',
      dataset,
      visible: true,
      opacity: 0.5,
      zIndex: 3
    })
    expect(layer.getOpacity()).toBe(0.5)
    expect(layer.getZIndex()).toBe(3)
    expect(layer.get('gisBboxWgs84')).toEqual([-10, 40, 10, 60])
    const source = layer.getSource()!
    expect(source.getParams().LAYERS).toBe('cities')
    expect(source.getParams().STYLES).toBe('outline')
    expect(source.getParams().VERSION).toBe('1.3.0')
    expect(source.getUrls()?.[0]).toContain('map=')
  })

  it('refreshWmsTileLayer bumps retry param', () => {
    const layer = createWmsTileLayer({ layerId: 'layer-1', dataset })
    refreshWmsTileLayer(layer)
    expect(String(layer.getSource()!.getParams()._retry)).toMatch(/^\d+$/)
  })
})
