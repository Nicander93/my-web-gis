import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WmtsDataset } from '@desktop-webgis/gis-core'
import {
  listCompatibleTileMatrixSets,
  parseCapabilitiesXml,
  resolveWmtsLayerOptions,
  resolutionFromScaleDenominator
} from '@desktop-webgis/ogc-io'
import { buildWmtsTileGrid } from './buildWmtsTileGrid'
import { createWmtsTileLayer, refreshWmtsTileLayer } from './createWmtsLayer'
import { getWmtsTileUrl } from './tileUrl'

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../ogc-io/fixtures'
)

function load(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8')
}

describe('WMTS tile grid from real matrices (P17)', () => {
  it('uses non-numeric matrix IDs and 512px tile size', () => {
    const desc = parseCapabilitiesXml(load('wmts-1.0.0-capabilities.xml'), {
      shareableUrl: 'https://example.com/wmts',
      hint: 'WMTS'
    })
    const resolved = resolveWmtsLayerOptions(desc, {
      layer: 'ortho',
      tileMatrixSet: 'CustomNonNumeric512'
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    expect(resolved.options.tileMatrices[0]?.identifier).toBe('EPSG:3857:0')
    expect(resolved.options.tileMatrices[0]?.tileWidth).toBe(512)

    const built = buildWmtsTileGrid({
      projection: resolved.options.projection,
      tileMatrices: resolved.options.tileMatrices
    })
    expect(built.matrixIds).toEqual(['EPSG:3857:0', 'EPSG:3857:1'])
    expect(built.tileSizes[0]).toBe(512)
    expect(built.origins[0]).toEqual([-20037508.34278925, 20037508.34278925])
    expect(built.resolutions[0]).toBeCloseTo(
      resolutionFromScaleDenominator(559082264.0287178, 1),
      6
    )
  })

  it('does not silently substitute an unlinked matrix set', () => {
    const desc = parseCapabilitiesXml(load('wmts-1.0.0-capabilities.xml'), {
      shareableUrl: 'https://example.com/wmts',
      hint: 'WMTS'
    })
    const resolved = resolveWmtsLayerOptions(desc, {
      layer: 'ortho',
      tileMatrixSet: 'DoesNotExist'
    })
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.reason).toMatch(/不会改用其他矩阵|未链接/)
  })

  it('lists compatible TMS and marks incomplete / unsupported clearly', () => {
    const desc = parseCapabilitiesXml(load('wmts-1.0.0-capabilities.xml'), {
      shareableUrl: 'https://example.com/wmts',
      hint: 'WMTS'
    })
    const sets = listCompatibleTileMatrixSets(desc, 'ortho')
    expect(sets.every((s) => s.compatible)).toBe(true)
    expect(sets.map((s) => s.identifier)).toEqual([
      'GoogleMapsCompatible',
      'CustomNonNumeric512'
    ])
  })
})

describe('WMTS KVP and REST encodings', () => {
  it('builds KVP GetTile URL with real matrix id at edge tile', () => {
    const desc = parseCapabilitiesXml(load('wmts-1.0.0-capabilities.xml'), {
      shareableUrl: 'https://example.com/wmts',
      hint: 'WMTS'
    })
    const resolved = resolveWmtsLayerOptions(desc, {
      layer: 'ortho',
      tileMatrixSet: 'GoogleMapsCompatible',
      requestEncoding: 'KVP'
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    const dataset: WmtsDataset = {
      id: 'ds-wmts-kvp',
      name: 'Ortho',
      kind: 'wmts',
      source: {
        type: 'wmts',
        url: resolved.options.urls[0]!,
        version: '1.0.0',
        layer: resolved.options.layer,
        style: resolved.options.style,
        format: resolved.options.format,
        tileMatrixSet: resolved.options.tileMatrixSet,
        requestEncoding: 'KVP',
        urls: resolved.options.urls,
        projection: resolved.options.projection,
        supportedCrs: resolved.options.supportedCrs,
        bboxWgs84: resolved.options.bboxWgs84,
        tileMatrices: resolved.options.tileMatrices,
        authMode: 'none'
      }
    }

    const layer = createWmtsTileLayer({ layerId: 'L1', dataset })
    const source = layer.getSource()!
    expect(source.getRequestEncoding()).toBe('KVP')
    expect(source.getLayer()).toBe('ortho')
    expect(source.getMatrixSet()).toBe('GoogleMapsCompatible')

    const tileGrid = source.getTileGrid()!
    // Edge of world near top-left origin → tile [1, 0, 0] at z=1 should be valid.
    const edgeCoord = tileGrid.getTileCoordForCoordAndZ(
      [-20037508.34278925 + 1, 20037508.34278925 - 1],
      1
    )
    expect(edgeCoord[0]).toBe(1)
    expect(edgeCoord[1]).toBe(0)
    expect(edgeCoord[2]).toBe(0)

    const url = getWmtsTileUrl(source, edgeCoord)!
    expect(url).toMatch(/REQUEST=GetTile|request=GetTile/i)
    expect(url).toMatch(/TILEMATRIX=1|TileMatrix=1/)
    expect(url).toMatch(/TILEROW=0|TileRow=0/)
    expect(url).toMatch(/TILECOL=0|TileCol=0/)
    expect(url).not.toMatch(/token=/i)
  })

  it('builds REST template URL without embedding credentials', () => {
    const desc = parseCapabilitiesXml(load('wmts-1.0.0-rest-capabilities.xml'), {
      shareableUrl: 'https://tiles.example.com/wmts',
      hint: 'WMTS'
    })
    expect(desc.wmtsRequestEncodings).toContain('REST')
    const resolved = resolveWmtsLayerOptions(desc, {
      layer: 'coast',
      requestEncoding: 'REST'
    })
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.options.requestEncoding).toBe('REST')
    expect(resolved.options.urls[0]).toContain('{TileMatrix}')
    expect(resolved.options.urls[0]).not.toMatch(/token=/i)

    const dataset: WmtsDataset = {
      id: 'ds-wmts-rest',
      name: 'Coast',
      kind: 'wmts',
      source: {
        type: 'wmts',
        url: resolved.options.urls[0]!,
        version: '1.0.0',
        layer: resolved.options.layer,
        style: resolved.options.style,
        format: resolved.options.format,
        tileMatrixSet: resolved.options.tileMatrixSet,
        requestEncoding: 'REST',
        urls: resolved.options.urls,
        projection: resolved.options.projection,
        tileMatrices: resolved.options.tileMatrices,
        authMode: 'none'
      }
    }

    const layer = createWmtsTileLayer({ layerId: 'L2', dataset })
    const source = layer.getSource()!
    expect(source.getRequestEncoding()).toBe('REST')
    const url = getWmtsTileUrl(source, [1, 0, 0])!
    expect(url).toContain('/coast/')
    expect(url).toMatch(/\/1\/0\/0\.png$/)
    expect(url).not.toMatch(/token=/i)

    refreshWmtsTileLayer(layer)
  })
})
