import type { CrsInfo, CsvImportOptions } from '@desktop-webgis/vector-io'
import { readBinaryFile } from './files'
import { runImportTask, runImportWorker } from './import-worker'
import { runLoggedTask } from './task-log'
import type { ImportResult } from './import-parser'
export type { ImportResult, ImportLayerResult } from './import-parser'

function importSummary(result: ImportResult) {
  return { failed: result.errors.length > 0, detail: result.errors.length ? result.errors.join('\n')
    : `解析完成：${result.layers.length} 个图层，${result.layers.reduce((sum, layer) => sum + layer.features.length, 0)} 个要素。等待确认导入。\n${result.layers.flatMap(layer => layer.warnings).join('\n')}` }
}

async function importSource(source: string | File, signal?: AbortSignal): Promise<File> {
  signal?.throwIfAborted()
  if (typeof source !== 'string') return source
  const bytes = await readBinaryFile(source)
  signal?.throwIfAborted()
  return new File([new Uint8Array(bytes)], source.replaceAll('\\', '/').split('/').pop() || 'imported')
}

export async function importGeoJson(source: string | File, options: { sourceCrs?: CrsInfo } = {}, signal?: AbortSignal) {
  return runLoggedTask('解析 GeoJSON', async operation => runImportWorker({ kind: 'geojson', source: await importSource(source, operation), options }, operation), signal, importSummary)
}

export async function importShapefileZip(source: string | File, options?: { selectedLayers?: string[] }, signal?: AbortSignal) {
  return runLoggedTask('解析 SHP ZIP', async operation => runImportWorker({ kind: 'shapefile', source: await importSource(source, operation), options }, operation), signal, importSummary)
}

export async function importDxfFile(source: string | File, options?: { crs?: CrsInfo; selectedLayers?: string[] }, signal?: AbortSignal) {
  return runLoggedTask('解析 DXF', async operation => runImportWorker({ kind: 'dxf', source: await importSource(source, operation), options }, operation), signal, importSummary)
}

export async function importCsvFile(source: string | File, options: CsvImportOptions, signal?: AbortSignal) {
  return runLoggedTask('解析 CSV', async operation => runImportWorker({ kind: 'csv', source: await importSource(source, operation), options }, operation), signal, importSummary)
}

export async function inspectDxfLayers(source: string | File, signal?: AbortSignal) {
  return runLoggedTask('检查 DXF 图层', async operation => runImportTask<string[]>({ kind: 'dxf-layers', source: await importSource(source, operation) }, operation), signal, layers => ({ detail: `发现 ${layers.length} 个图层` }))
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
