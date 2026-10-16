import type { CrsInfo, CsvImportOptions } from '@desktop-webgis/vector-io'
import { readBinaryFile } from './files'
import { runImportTask, runImportWorker } from './import-worker'
export type { ImportResult, ImportLayerResult } from './import-parser'

async function importSource(source: string | File, signal?: AbortSignal): Promise<File> {
  signal?.throwIfAborted()
  if (typeof source !== 'string') return source
  const bytes = await readBinaryFile(source)
  signal?.throwIfAborted()
  return new File([new Uint8Array(bytes)], source.replaceAll('\\', '/').split('/').pop() || 'imported')
}

export async function importGeoJson(source: string | File, options: { sourceCrs?: CrsInfo } = {}, signal?: AbortSignal) {
  return runImportWorker({ kind: 'geojson', source: await importSource(source, signal), options }, signal)
}

export async function importShapefileZip(source: string | File, options?: { selectedLayers?: string[] }, signal?: AbortSignal) {
  return runImportWorker({ kind: 'shapefile', source: await importSource(source, signal), options }, signal)
}

export async function importDxfFile(source: string | File, options?: { crs?: CrsInfo; selectedLayers?: string[] }, signal?: AbortSignal) {
  return runImportWorker({ kind: 'dxf', source: await importSource(source, signal), options }, signal)
}

export async function importCsvFile(source: string | File, options: CsvImportOptions, signal?: AbortSignal) {
  return runImportWorker({ kind: 'csv', source: await importSource(source, signal), options }, signal)
}

export async function inspectDxfLayers(source: string | File, signal?: AbortSignal) {
  return runImportTask<string[]>({ kind: 'dxf-layers', source: await importSource(source, signal) }, signal)
}

export function getFileExtension(fileName: string): string {
  return fileName.match(/\.([^.]+)$/)?.[1].toLowerCase() || ''
}

export function detectFileType(fileName: string): 'geojson' | 'shapefile' | 'dxf' | 'csv' | 'unknown' {
  const extension = getFileExtension(fileName)
  if (extension === 'geojson' || extension === 'json') return 'geojson'
  if (extension === 'zip') return 'shapefile'
  if (extension === 'dxf' || extension === 'csv') return extension
  return 'unknown'
}
