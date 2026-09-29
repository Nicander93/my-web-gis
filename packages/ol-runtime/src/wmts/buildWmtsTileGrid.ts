import WMTSTileGrid from 'ol/tilegrid/WMTS'
import { get as getProjection } from 'ol/proj'
import type { WmtsPersistedMatrix } from '@desktop-webgis/gis-core'
import {
  normalizeCrsCode,
  resolutionFromScaleDenominator
} from '@desktop-webgis/ogc-io'

export interface BuildWmtsTileGridInput {
  projection: string
  tileMatrices: WmtsPersistedMatrix[]
  /** Optional extent in projection coordinates. */
  extent?: [number, number, number, number]
}

export interface BuildWmtsTileGridResult {
  tileGrid: WMTSTileGrid
  matrixIds: string[]
  resolutions: number[]
  origins: Array<[number, number]>
  tileSizes: Array<number | [number, number]>
  projectionCode: string
}

/**
 * Build a WMTSTileGrid from persisted TileMatrix definitions.
 * Uses real origin / ScaleDenominator / matrix ID / tile size — never invents XYZ zooms.
 */
export function buildWmtsTileGrid(input: BuildWmtsTileGridInput): BuildWmtsTileGridResult {
  const projectionCode = normalizeCrsCode(input.projection) || input.projection
  const projection = getProjection(projectionCode)
  if (!projection) {
    throw new Error(`不兼容投影：无法识别 "${input.projection}"，请选择含 EPSG:3857 / EPSG:4326 的 TileMatrixSet`)
  }
  if (!input.tileMatrices.length) {
    throw new Error('缺少 TileMatrix 定义，无法构建瓦片网格')
  }

  const metersPerUnit = projection.getMetersPerUnit() ?? 1
  const switchOriginXY = projection.getAxisOrientation().startsWith('ne')

  const matrices = [...input.tileMatrices].sort(
    (a, b) => b.scaleDenominator - a.scaleDenominator
  )

  const matrixIds: string[] = []
  const resolutions: number[] = []
  const origins: Array<[number, number]> = []
  const tileSizes: Array<number | [number, number]> = []

  for (const matrix of matrices) {
    if (!matrix.identifier) {
      throw new Error('TileMatrix 缺少 identifier（支持非数字 ID，但不能为空）')
    }
    if (!Number.isFinite(matrix.scaleDenominator) || matrix.scaleDenominator <= 0) {
      throw new Error(`TileMatrix "${matrix.identifier}" 缺少有效 ScaleDenominator`)
    }
    if (!matrix.topLeftCorner || matrix.topLeftCorner.length < 2) {
      throw new Error(`TileMatrix "${matrix.identifier}" 缺少 TopLeftCorner`)
    }
    if (!matrix.tileWidth || !matrix.tileHeight) {
      throw new Error(`TileMatrix "${matrix.identifier}" 缺少 TileWidth/TileHeight`)
    }

    const origin: [number, number] = switchOriginXY
      ? [matrix.topLeftCorner[1], matrix.topLeftCorner[0]]
      : [matrix.topLeftCorner[0], matrix.topLeftCorner[1]]

    matrixIds.push(matrix.identifier)
    resolutions.push(resolutionFromScaleDenominator(matrix.scaleDenominator, metersPerUnit))
    origins.push(origin)
    tileSizes.push(
      matrix.tileWidth === matrix.tileHeight
        ? matrix.tileWidth
        : [matrix.tileWidth, matrix.tileHeight]
    )
  }

  const tileGrid = new WMTSTileGrid({
    origins,
    resolutions,
    matrixIds,
    tileSizes,
    extent: input.extent
  })

  return { tileGrid, matrixIds, resolutions, origins, tileSizes, projectionCode }
}
