import { get as getProjection } from 'ol/proj'
import { getRequestUrl, getRequestParams } from 'ol/source/wms.js'

export interface BuildGetMapUrlInput {
  url: string
  version: string
  layers: string
  styles?: string
  format?: string
  transparent?: boolean
  /** 请求使用的 CRS 代码，例如 EPSG:4326 或 EPSG:3857。 */
  crs: string
  /** 坐标轴交换之前、OpenLayers 期望的请求投影坐标轴顺序下的范围。 */
  extent: [number, number, number, number]
  width: number
  height: number
  extraParams?: Record<string, string>
}

export interface BuildGetMapUrlResult {
  url: string
  /** 最终放到请求上的 BBOX 字符串；WMS 1.3 且轴方向为 ne 时可能已交换。 */
  bbox: string
  /** 实际使用的 CRS 或 SRS 参数名。 */
  crsParam: 'CRS' | 'SRS'
  crsValue: string
  version: string
}

/**
 * 用 OpenLayers 官方辅助函数构造 GetMap URL，让 VERSION 和坐标轴顺序
 * 与运行时 TileWMS 的行为一致：EPSG:4326 加 1.3.0 时 BBOX 使用纬度,经度。
 */
export function buildGetMapUrl(input: BuildGetMapUrlInput): BuildGetMapUrlResult {
  const projection = getProjection(input.crs)
  if (!projection) {
    throw new Error(`Unknown projection: ${input.crs}`)
  }

  const params = getRequestParams(
    {
      LAYERS: input.layers,
      STYLES: input.styles ?? '',
      FORMAT: input.format ?? 'image/png',
      TRANSPARENT: input.transparent === false ? 'FALSE' : 'TRUE',
      VERSION: input.version,
      ...(input.extraParams ?? {})
    },
    'GetMap'
  )

  const url = getRequestUrl(
    input.url,
    input.extent,
    [input.width, input.height],
    projection,
    params
  )

  const version = String(params.VERSION)
  const v13 = compareVersion(version, '1.3') >= 0
  const crsParam: 'CRS' | 'SRS' = v13 ? 'CRS' : 'SRS'
  return {
    url,
    bbox: String(params.BBOX),
    crsParam,
    crsValue: String(params[crsParam]),
    version
  }
}

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da > db) return 1
    if (da < db) return -1
  }
  return 0
}
