import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { importShapefileZipLayers, importShapefile } from './shapefile.js'

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
    const result = await importShapefileZipLayers(buffer)
    
    const layer = result.layers[0]
    expect(layer.hasPrj).toBe(false)
    
    const warning = layer.warnings.find(w => w.code === 'shapefile.missingPrj')
    expect(warning).toBeDefined()
    expect(warning?.message).toContain('缺少 .prj 文件')
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
