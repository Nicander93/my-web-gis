import { parseGeoJsonFeatures, inferLayerStyleKind, createId } from '@desktop-webgis/gis-core'
import type { GisFeature } from '@desktop-webgis/gis-core'
import { importShapefile, importDxf, createCoordinateTransform } from '@desktop-webgis/vector-io'
import type { CrsInfo } from '@desktop-webgis/vector-io'
import { readFile, readBinaryFile } from './files'

const STORE_CRS = 'EPSG:4326'

export interface ImportLayerResult {
  name: string
  features: GisFeature[]
  styleKind: 'point' | 'line' | 'polygon' | 'mixed'
  warnings: string[]
}

export interface ImportResult {
  layers: ImportLayerResult[]
  errors: string[]
}

export async function importGeoJson(source: string | File): Promise<ImportResult> {
  try {
    let content: string
    let fileName: string

    if (typeof source === 'string') {
      content = await readFile(source, false) as string
      fileName = source.split('/').pop() || source.split('\\').pop() || 'imported'
    } else {
      content = await source.text()
      fileName = source.name
    }

    const parseResult = parseGeoJsonFeatures(content, {
      importId: createId('import'),
      sourceCrs: STORE_CRS
    })
    
    const styleKind = inferLayerStyleKind(parseResult.features)
    const name = fileName.replace(/\.geojsons?$/i, '')

    return {
      layers: [{ 
        name, 
        features: parseResult.features, 
        styleKind, 
        warnings: parseResult.warnings.map(w => w.message)
      }],
      errors: []
    }
  } catch (error) {
    return {
      layers: [],
      errors: [error instanceof Error ? error.message : String(error)]
    }
  }
}

export async function importShapefileZip(source: string | File): Promise<ImportResult> {
  try {
    let buffer: ArrayBuffer | ArrayBufferView
    let fileName: string

    if (typeof source === 'string') {
      buffer = await readBinaryFile(source)
      fileName = source.split('/').pop() || source.split('\\').pop() || 'imported'
    } else {
      buffer = await source.arrayBuffer()
      fileName = source.name
    }

    const result = await importShapefile(buffer)
    
    const transformResult = result.crs?.code === STORE_CRS 
      ? { success: true, transform: (c: number[]) => c }
      : createCoordinateTransform(result.crs, STORE_CRS)
    
    if (!transformResult.success) {
      return {
        layers: [],
        errors: [`坐标转换失败: ${transformResult.error}`]
      }
    }
    
    const parseResult = parseGeoJsonFeatures(result.featureCollection, {
      importId: createId('import'),
      sourceCrs: result.sourceCrs?.code || result.crs?.code,
      transform: transformResult.transform
    })
    
    const allWarnings = [
      ...result.warnings.map(w => w.message),
      ...parseResult.warnings.map(w => w.message)
    ]
    
    const styleKind = inferLayerStyleKind(parseResult.features)
    const baseName = fileName.replace(/\.zip$/i, '')

    return {
      layers: [{ 
        name: baseName, 
        features: parseResult.features, 
        styleKind,
        warnings: allWarnings
      }],
      errors: []
    }
  } catch (error) {
    return {
      layers: [],
      errors: [error instanceof Error ? error.message : String(error)]
    }
  }
}

export async function importDxfFile(
  source: string | File, 
  crs?: CrsInfo
): Promise<ImportResult> {
  try {
    let content: string
    let fileName: string

    if (typeof source === 'string') {
      content = await readFile(source, false) as string
      fileName = source.split('/').pop() || source.split('\\').pop() || 'imported'
    } else {
      content = await source.text()
      fileName = source.name
    }

    const result = await importDxf(content, { crs })
    
    if (!crs) {
      return {
        layers: [],
        errors: ['DXF 文件未包含坐标系信息,请选择坐标系后重试。']
      }
    }
    
    const transformResult = crs.code === STORE_CRS
      ? { success: true, transform: (c: number[]) => c }
      : createCoordinateTransform(crs, STORE_CRS)
    
    if (!transformResult.success) {
      return {
        layers: [],
        errors: [`坐标转换失败: ${transformResult.error}`]
      }
    }
    
    const parseResult = parseGeoJsonFeatures(result.featureCollection, {
      importId: createId('import'),
      sourceCrs: crs.code,
      transform: transformResult.transform
    })
    
    const allWarnings = [
      ...result.warnings.filter(w => w.code !== 'dxf.unknownCrs').map(w => w.message),
      ...parseResult.warnings.map(w => w.message)
    ]
    
    const styleKind = inferLayerStyleKind(parseResult.features)
    const baseName = fileName.replace(/\.dxf$/i, '')

    return {
      layers: [{ 
        name: baseName, 
        features: parseResult.features, 
        styleKind,
        warnings: allWarnings
      }],
      errors: []
    }
  } catch (error) {
    return {
      layers: [],
      errors: [error instanceof Error ? error.message : String(error)]
    }
  }
}

export function getFileExtension(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/)
  return match ? match[1].toLowerCase() : ''
}

export function detectFileType(fileName: string): 'geojson' | 'shapefile' | 'dxf' | 'unknown' {
  const ext = getFileExtension(fileName)
  if (ext === 'geojson' || ext === 'json') return 'geojson'
  if (ext === 'zip') return 'shapefile'
  if (ext === 'dxf') return 'dxf'
  return 'unknown'
}
