import proj4 from 'proj4'
import type { CrsInfo } from './types.js'
import type { GeoJsonGeometry } from '@desktop-webgis/scene-schema'
import { registerCrsPresets } from './crs-presets.js'

const WGS84 = 'EPSG:4326'
const WEB_MERCATOR = 'EPSG:3857'

registerCrsPresets()

export interface TransformResult {
  success: boolean
  transform?: (coords: number[]) => number[]
  error?: string
}

export function createCoordinateTransform(
  sourceCrs: CrsInfo | undefined,
  targetCrs: string | CrsInfo = WGS84
): TransformResult {
  if (!sourceCrs || (!sourceCrs.code && !sourceCrs.proj4 && !sourceCrs.wkt)) {
    return { success: false, error: '源坐标系未定义；请提供代码、PROJ 或 WKT 定义。' }
  }
  
  try {
    const sourceProj = getProjection(sourceCrs)
    const target = typeof targetCrs === 'string' ? { code: targetCrs } : targetCrs
    const targetProj = getProjection(target)
    
    if (!sourceProj || !targetProj) {
      return { success: false, error: '无法解析坐标系定义' }
    }
    
    const transformer = proj4(sourceProj, targetProj)
    
    return {
      success: true,
      transform: (coords: number[]) => {
        if (coords.length < 2 || !coords.every(Number.isFinite)) throw new Error('坐标至少需要两个有限数值。')
        validateKnownCoordinates(coords, sourceCrs)
        if (!sourceCrs.proj4 && !sourceCrs.wkt && sourceCrs.code === WGS84 && target.code === WEB_MERCATOR && Math.abs(coords[1]) > 85.0511287798066) throw new Error('纬度超出 Web Mercator 的适用范围。')
        
        const [x, y, ...rest] = coords
        const [tx, ty] = transformer.forward([x, y])
        if (!Number.isFinite(tx) || !Number.isFinite(ty)) throw new Error('坐标转换产生非有限结果。')
        validateKnownCoordinates([tx, ty], target)
        
        return rest.length > 0 ? [tx, ty, ...rest] : [tx, ty]
      }
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '坐标转换失败'
    }
  }
}

function getProjection(crs: CrsInfo): string | undefined {
  if (crs.proj4) return crs.proj4
  if (crs.wkt) return crs.wkt
  if (crs.code && proj4.defs(crs.code)) {
    return crs.code
  }
  
  return crs.code
}

function validateKnownCoordinates(coords: number[], crs: CrsInfo): void {
  if (crs.proj4 || crs.wkt) return
  if (crs.code === WGS84 && (Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90)) throw new Error('WGS84 经度须在 ±180°、纬度须在 ±90° 内。')
  if (crs.code === WEB_MERCATOR && (Math.abs(coords[0]) > 20037508.34278925 || Math.abs(coords[1]) > 20037508.34278925)) throw new Error('坐标超出 Web Mercator 的世界范围。')
}

/** Transform every XY position, preserving Z/M values and dropping stale geometry bounds. */
export function transformGeometry<T extends GeoJsonGeometry>(
  geometry: T,
  transform: (coords: number[]) => number[]
): T {
  const result = structuredClone(geometry)
  Reflect.deleteProperty(result, 'bbox')
  switch (result.type) {
    case 'Point': result.coordinates = transform(result.coordinates); break
    case 'MultiPoint':
    case 'LineString': result.coordinates = result.coordinates.map(transform); break
    case 'MultiLineString':
    case 'Polygon': result.coordinates = result.coordinates.map(ring => ring.map(transform)); break
    case 'MultiPolygon': result.coordinates = result.coordinates.map(polygon => polygon.map(ring => ring.map(transform))); break
    case 'GeometryCollection': result.geometries = result.geometries.map(member => transformGeometry(member, transform)); break
    default: throw new Error('不支持的几何类型。')
  }
  return result
}

/** Reproject ordinary features without UI or map engines. Coordinates change; IDs and properties do not. */
export function reprojectFeatures<T extends { geometry: GeoJsonGeometry | null }>(
  features: readonly T[], sourceCrs: CrsInfo, targetCrs: string | CrsInfo
): T[] {
  const conversion = createCoordinateTransform(sourceCrs, targetCrs)
  if (!conversion.success || !conversion.transform) throw new Error(conversion.error ?? '坐标转换失败。')
  const transform = conversion.transform
  return features.map((feature, index) => {
    try {
      const result = structuredClone(feature)
      Reflect.deleteProperty(result, 'bbox')
      if (result.geometry) result.geometry = transformGeometry(result.geometry, transform)
      return result
    } catch (error) { throw new Error(`第 ${index + 1} 个要素：${error instanceof Error ? error.message : '转换失败'}`) }
  })
}
