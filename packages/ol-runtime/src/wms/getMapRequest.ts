import { get as getProjection } from 'ol/proj'
import { getRequestUrl, getRequestParams } from 'ol/source/wms.js'

export interface BuildGetMapUrlInput {
  url: string
  version: string
  layers: string
  styles?: string
  format?: string
  transparent?: boolean
  /** Request CRS code, e.g. EPSG:4326 or EPSG:3857. */
  crs: string
  /** Extent in the request projection axis order expected by OL before axis swap. */
  extent: [number, number, number, number]
  width: number
  height: number
  extraParams?: Record<string, string>
}

export interface BuildGetMapUrlResult {
  url: string
  /** Final BBOX string placed on the request (may be axis-swapped for WMS 1.3 + ne). */
  bbox: string
  /** CRS or SRS parameter name used. */
  crsParam: 'CRS' | 'SRS'
  crsValue: string
  version: string
}

/**
 * Build a GetMap URL using OpenLayers official helpers so VERSION / axis order
 * match runtime TileWMS behaviour (EPSG:4326 + 1.3.0 uses lat,lon BBOX).
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
