import type { GeoJsonGeometry } from '@desktop-webgis/scene-schema'
import { reprojectFeatures } from './coordinate-transform.js'
import { featuresToCsv } from './csv-write.js'
import type { CrsInfo } from './types.js'

export interface CoordinateCsvFeature {
  id?: string | number
  geometry: GeoJsonGeometry | null
  properties?: Record<string, unknown> | null
}

/** Export single-point XY and an explicit CRS column; never alter or silently discard input geometries. */
export function pointsToCoordinateCsv(features: readonly CoordinateCsvFeature[], sourceCrs: CrsInfo, targetCrs: CrsInfo): string | null {
  if (!targetCrs.code?.trim()) throw new Error('坐标 CSV 需要明确的目标坐标系代码。')
  for (const feature of features) {
    if (feature.geometry?.type !== 'Point') throw new Error('坐标 CSV 仅支持单点要素；多点、线、面请使用几何格式导出。')
    if (['id', 'x', 'y', 'crs'].some(field => Object.hasOwn(feature.properties ?? {}, field))) throw new Error('属性含 id、x、y 或 crs 字段，请先重命名，避免导出列冲突。')
  }
  const projected = reprojectFeatures(features, sourceCrs, targetCrs)
  return featuresToCsv(projected.map(feature => {
    if (feature.geometry?.type !== 'Point') throw new Error('坐标 CSV 仅支持单点要素。')
    return { ...feature, geometry: feature.geometry, properties: { ...feature.properties, crs: targetCrs.code } }
  }), { includePointXY: true, formulaGuard: true })
}
