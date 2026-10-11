import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { importShapefileZipLayers, importShapefile } from './shapefile.js'
import { unzipSync, zipSync } from 'fflate'

describe('Shapefile Import', () => {
  it('imports single shapefile with correct attributes', async () => {
    const buffer = await readFile('../../examples/phase-1/single-shapefile.zip')
    const result = await importShapefileZipLayers(buffer)
    
    expect(result.layers).toHaveLength(1)
    
    const layer = result.layers[0]
    expect(layer.name).toMatch(/POINT/)
    expect(layer.featureCollection.features).toHaveLength(2)
    expect(layer.crs?.code).toBe('EPSG:4326')
    
    const firstFeature = layer.featureCollection.features[0]
    expect(firstFeature.properties).toHaveProperty('id')
    expect(firstFeature.properties).toHaveProperty('name')
    expect(firstFeature.properties.name).toBe('Beijing')
  })
  
  it('imports multiple shapefiles from one ZIP', async () => {
    const buffer = await readFile('../../examples/phase-1/multi-shapefile.zip')
    const result = await importShapefileZipLayers(buffer)
    
    expect(result.layers).toHaveLength(2)
    
    const pointLayer = result.layers.find(l => l.name.includes('POINT'))
    const lineLayer = result.layers.find(l => l.name.includes('POLYLINE'))
    
    expect(pointLayer).toBeDefined()
    expect(lineLayer).toBeDefined()
    
    expect(pointLayer!.featureCollection.features).toHaveLength(2)
    expect(lineLayer!.featureCollection.features).toHaveLength(1)
  })
  
  it('detects missing .prj file', async () => {
    const buffer = await readFile('../../examples/phase-1/single-shapefile.zip')
    const entries = unzipSync(buffer)
    for (const name of Object.keys(entries)) if (name.endsWith('.prj')) delete entries[name]
    const result = await importShapefileZipLayers(zipSync(entries))
    const layer = result.layers[0]
    expect(layer.hasPrj).toBe(false)
    
    const warning = layer.warnings.find(w => w.code === 'shapefile.missingPrj')
    expect(warning).toBeDefined()
    expect(warning?.message).toContain('缺少 .prj 文件')
  })

  it('retains actual PRJ metadata and decodes Chinese fields in a projected multilayer ZIP', async () => {
    const buffer = await readFile('../../examples/phase-1/projected-chinese-multi.zip')
    const result = await importShapefileZipLayers(buffer)
    expect(result.layers).toHaveLength(3)
    expect(result.layers.every(layer => layer.hasPrj && layer.sourceCrs?.code === 'EPSG:3857' && layer.warnings.length === 0)).toBe(true)
    const feature = result.layers.find(layer => layer.name === 'stations')!.featureCollection.features[0]
    expect(feature.properties).toMatchObject({ 编号: '01', 名称: '北京站' })
    expect(feature.geometry).toMatchObject({ coordinates: [expect.closeTo(116.4, 6), expect.closeTo(39.9, 6)] })
  })

  it('rejects invalid PRJ instead of letting the parser silently assume raw coordinates', async () => {
    const entries = unzipSync(await readFile('../../examples/phase-1/projected-chinese-multi.zip'))
    entries['stations.prj'] = new TextEncoder().encode('not a coordinate reference system')
    await expect(importShapefileZipLayers(zipSync(entries))).rejects.toThrow('投影定义无效')
  })

  it('retains WKT without guessing a nested unit authority as the source EPSG code', async () => {
    const entries = unzipSync(await readFile('../../examples/phase-1/projected-chinese-multi.zip'))
    const wkt = new TextDecoder().decode(entries['stations.prj'])
      .replace(',AUTHORITY["EPSG","3857"]', '')
      .replace('UNIT["metre",1]', 'UNIT["metre",1,AUTHORITY["EPSG","9001"]]')
    entries['stations.prj'] = new TextEncoder().encode(wkt)
    const result = await importShapefileZipLayers(zipSync(entries))
    expect(result.layers.find(layer => layer.name === 'stations')!.sourceCrs).toEqual({ wkt })
  })
  
  it('backward compatibility: importShapefile merges layers', async () => {
    const buffer = await readFile('../../examples/phase-1/multi-shapefile.zip')
    const result = await importShapefile(buffer)
    
    expect(result.featureCollection.features).toHaveLength(3)
    expect(result.crs?.code).toBe('EPSG:4326')
    expect(result.sourceLayers).toHaveLength(2)
    expect(result.warnings.length).toBeGreaterThan(0)
    
    const mergeWarning = result.warnings.find(w => w.code === 'shapefile.multipleLayers')
    expect(mergeWarning).toBeDefined()
  })
})
