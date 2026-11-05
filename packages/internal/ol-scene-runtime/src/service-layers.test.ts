import { describe, expect, it } from 'vitest'
import { buildSceneWmtsTileGrid } from './service-layers.js'

describe('portable WMTS matrix fidelity', () => {
  it('retains per-level origins, rectangular tile sizes and geographic axis order', () => {
    const { tileGrid, projectionCode } = buildSceneWmtsTileGrid({ type: 'wmts', url: 'https://example.test/wmts', version: '1.0.0', layer: 'map', tileMatrixSet: 'geographic', requestEncoding: 'KVP', authMode: 'none', supportedCrs: 'urn:ogc:def:crs:EPSG::4326', tileMatrices: [
      { identifier: 'fine', scaleDenominator: 1000, topLeftCorner: [80, -170], tileWidth: 128, tileHeight: 256, matrixWidth: 4, matrixHeight: 4 },
      { identifier: 'coarse', scaleDenominator: 2000, topLeftCorner: [90, -180], tileWidth: 256, tileHeight: 512, matrixWidth: 2, matrixHeight: 2 }
    ] })
    expect(projectionCode).toBe('EPSG:4326')
    expect(tileGrid.getMatrixIds()).toEqual(['coarse', 'fine'])
    expect(tileGrid.getOrigin(0)).toEqual([-180, 90]); expect(tileGrid.getOrigin(1)).toEqual([-170, 80])
    expect(tileGrid.getTileSize(0)).toEqual([256, 512]); expect(tileGrid.getTileSize(1)).toEqual([128, 256])
  })
})
