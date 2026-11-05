import { stringifyGeoJson, type GisFeature } from '@desktop-webgis/project'
import { featuresToCsv, pointsToCoordinateCsv, type CrsPresetCode } from '@desktop-webgis/vector-io'

export type ExportFormat = 'geojson' | 'csv' | 'coordinate-csv'
export type CoordinateExportCrs = CrsPresetCode

/** 打开保存对话框之前先序列化导出快照；导出的坐标不会进入项目 store。 */
export function serializeVectorExport(features: GisFeature[], format: ExportFormat, targetCrs: CoordinateExportCrs): { content: string; extension: string } {
  if (!features.length) throw new Error('当前导出范围没有要素。')
  if (format === 'geojson') return { content: stringifyGeoJson(features), extension: 'geojson' }
  const content = format === 'coordinate-csv'
    ? pointsToCoordinateCsv(features, { code: 'EPSG:4326' }, { code: targetCrs })
    : featuresToCsv(features, { formulaGuard: true })
  if (!content) throw new Error('当前导出范围没有要素。')
  return { content, extension: 'csv' }
}
