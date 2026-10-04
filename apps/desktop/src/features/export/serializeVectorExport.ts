import { stringifyGeoJson, type GisFeature } from '@desktop-webgis/gis-core'
import { featuresToCsv, pointsToCoordinateCsv } from '@desktop-webgis/vector-io'

export type ExportFormat = 'geojson' | 'csv' | 'coordinate-csv'
export type CoordinateExportCrs = 'EPSG:4326' | 'EPSG:3857'

/** Serialize an export snapshot before opening the save picker; exported coordinates never enter the project store. */
export function serializeVectorExport(features: GisFeature[], format: ExportFormat, targetCrs: CoordinateExportCrs): { content: string; extension: string } {
  if (!features.length) throw new Error('当前导出范围没有要素。')
  if (format === 'geojson') return { content: stringifyGeoJson(features), extension: 'geojson' }
  const content = format === 'coordinate-csv'
    ? pointsToCoordinateCsv(features, { code: 'EPSG:4326' }, { code: targetCrs })
    : featuresToCsv(features, { formulaGuard: true })
  if (!content) throw new Error('当前导出范围没有要素。')
  return { content, extension: 'csv' }
}
