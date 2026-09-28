import proj4 from 'proj4'
import type { CrsInfo } from './types.js'

const WGS84 = 'EPSG:4326'
const WEB_MERCATOR = 'EPSG:3857'

proj4.defs(WGS84, '+proj=longlat +datum=WGS84 +no_defs')
proj4.defs(WEB_MERCATOR, '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs')

export interface TransformResult {
  success: boolean
  transform?: (coords: number[]) => number[]
  error?: string
}

export function createCoordinateTransform(
  sourceCrs: CrsInfo | undefined,
  targetCrs: string = WGS84
): TransformResult {
  if (!sourceCrs || !sourceCrs.code) {
    return { success: false, error: '源坐标系未定义或缺少 EPSG 代码' }
  }
  
  if (sourceCrs.code === targetCrs) {
    return {
      success: true,
      transform: (coords) => coords
    }
  }
  
  try {
    const sourceProj = getProjection(sourceCrs)
    const targetProj = getProjection({ code: targetCrs })
    
    if (!sourceProj || !targetProj) {
      return { success: false, error: '无法解析坐标系定义' }
    }
    
    const transformer = proj4(sourceProj, targetProj)
    
    return {
      success: true,
      transform: (coords: number[]) => {
        if (coords.length < 2) return coords
        
        const [x, y, ...rest] = coords
        const [tx, ty] = transformer.forward([x, y])
        
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
  if (crs.code && proj4.defs(crs.code)) {
    return crs.code
  }
  
  if (crs.proj4) {
    return crs.proj4
  }
  
  if (crs.wkt) {
    return undefined
  }
  
  return crs.code
}

export function transformGeometry(
  geometry: any,
  transform: (coords: number[]) => number[]
): any {
  switch (geometry.type) {
    case 'Point':
      return {
        ...geometry,
        coordinates: transform(geometry.coordinates)
      }
    
    case 'MultiPoint':
    case 'LineString':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map(transform)
      }
    
    case 'MultiLineString':
    case 'Polygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring: number[][]) => 
          ring.map(transform)
        )
      }
    
    case 'MultiPolygon':
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon: number[][][]) =>
          polygon.map((ring: number[][]) => ring.map(transform))
        )
      }
    
    default:
      return geometry
  }
}
