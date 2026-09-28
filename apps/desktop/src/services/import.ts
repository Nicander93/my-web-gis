import { parseGeoJsonFeatures, inferLayerStyleKind } from '@desktop-webgis/gis-core'
import type { GisFeature } from '@desktop-webgis/gis-core'
import { importShapefile, importDxf, importCsv, previewCsv } from '@desktop-webgis/vector-io'
import type { CsvImportOptions, CsvPreviewResult } from '@desktop-webgis/vector-io'
import { readFile, readBinaryFile } from './files'

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

    const features = parseGeoJsonFeatures(content)
    const styleKind = inferLayerStyleKind(features)
    const name = fileName.replace(/\.geojsons?$/i, '')

    return {
      layers: [{ name, features, styleKind, warnings: [] }],
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
    const features = parseGeoJsonFeatures(result.featureCollection)
    const styleKind = inferLayerStyleKind(features)
    const baseName = fileName.replace(/\.zip$/i, '')

    return {
      layers: [{ 
        name: baseName, 
        features, 
        styleKind,
        warnings: result.warnings.map(w => w.message)
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

export async function importDxfFile(source: string | File): Promise<ImportResult> {
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

    const result = await importDxf(content)
    const features = parseGeoJsonFeatures(result.featureCollection)
    const styleKind = inferLayerStyleKind(features)
    const baseName = fileName.replace(/\.dxf$/i, '')

    return {
      layers: [{ 
        name: baseName, 
        features, 
        styleKind,
        warnings: result.warnings.map(w => w.message)
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

export function detectFileType(fileName: string): 'geojson' | 'shapefile' | 'dxf' | 'csv' | 'unknown' {
  const ext = getFileExtension(fileName)
  if (ext === 'geojson' || ext === 'json') return 'geojson'
  if (ext === 'zip') return 'shapefile'
  if (ext === 'dxf') return 'dxf'
  if (ext === 'csv') return 'csv'
  return 'unknown'
}

export async function previewCsvFile(source: string | File): Promise<CsvPreviewResult> {
  let content: string

  if (typeof source === 'string') {
    content = await readFile(source, false) as string
  } else {
    content = await source.text()
  }

  return previewCsv(content)
}

export async function importCsvFile(
  source: string | File,
  options: CsvImportOptions
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

    const result = importCsv(content, options)
    const features = parseGeoJsonFeatures(result.featureCollection)
    const styleKind = inferLayerStyleKind(features)
    const baseName = fileName.replace(/\.csv$/i, '')

    return {
      layers: [{ 
        name: baseName, 
        features, 
        styleKind,
        warnings: result.warnings.map(w => w.message)
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
