import { importGeoJson, importShapefileZip, importDxfFile, importCsvFile } from './import-parser'
import type { ImportTask } from './import-worker'

self.onmessage = async (event: MessageEvent<ImportTask>) => {
  const request = event.data
  try {
    if (request.kind === 'dxf-layers') {
      const { importDxfLayers } = await import('@desktop-webgis/vector-io/dxf')
      self.postMessage({ result: importDxfLayers(await request.source.text(), {}).layers.map(layer => layer.name) })
      return
    }
    if (request.kind === 'csv-preview') {
      const { previewCsv } = await import('@desktop-webgis/vector-io/csv')
      self.postMessage({ result: previewCsv(request.content, request.options) })
      return
    }
    const result = request.kind === 'geojson' ? await importGeoJson(request.source, request.options)
      : request.kind === 'shapefile' ? await importShapefileZip(request.source, request.options)
      : request.kind === 'dxf' ? await importDxfFile(request.source, request.options)
      : await importCsvFile(request.source, request.options)
    self.postMessage({ result })
  } catch (error) {
    self.postMessage({ failure: error instanceof Error ? error.message : String(error) })
  }
}
