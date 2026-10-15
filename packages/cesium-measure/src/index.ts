import { Cartesian3, Cartographic, EllipsoidGeodesic, Matrix4, Transforms, sampleTerrainMostDetailed } from 'cesium'
import type { Scene, TerrainProvider } from 'cesium'
import type { GeoPosition } from '@desktop-webgis/cesium-scene-schema'

export type SceneMeasurementKind = 'spatial-distance' | 'ground-distance' | 'area' | 'height-difference'

export interface SceneMeasurement {
  kind: SceneMeasurementKind
  value: number
  unit: 'm' | 'm²'
  label: string
}

function requirePositions(positions: readonly GeoPosition[], minimum: number): void {
  if (positions.length < minimum || !positions.every(position => position.length === 3 && position.every(Number.isFinite))) throw new Error(`测量至少需要 ${minimum} 个有效坐标`)
}

function cartesian(position: GeoPosition): Cartesian3 { return Cartesian3.fromDegrees(...position) }

/** Straight three-dimensional segment distance, including ellipsoid height. */
export function measureSpatialDistance(positions: readonly GeoPosition[]): SceneMeasurement {
  requirePositions(positions, 2)
  let value = 0
  for (let index = 1; index < positions.length; index++) value += Cartesian3.distance(cartesian(positions[index - 1]), cartesian(positions[index]))
  return { kind: 'spatial-distance', value, unit: 'm', label: formatMeasurement(value, 'm') }
}

/** Signed end-minus-start WGS84 ellipsoid height difference. */
export function measureHeightDifference(positions: readonly GeoPosition[]): SceneMeasurement {
  requirePositions(positions, 2)
  const value = positions.at(-1)![2] - positions[0][2]
  return { kind: 'height-difference', value, unit: 'm', label: `${value >= 0 ? '+' : ''}${formatMeasurement(value, 'm')}` }
}

/** Horizontal area in a local ENU plane. Suitable for bounded interactive measurements. */
export function measureArea(positions: readonly GeoPosition[]): SceneMeasurement {
  requirePositions(positions, 3)
  const center = positions.reduce((result, position) => [result[0] + position[0] / positions.length, result[1] + position[1] / positions.length, result[2] + position[2] / positions.length] as GeoPosition, [0, 0, 0] as GeoPosition)
  const worldToLocal = Matrix4.inverse(Transforms.eastNorthUpToFixedFrame(cartesian(center)), new Matrix4())
  const local = positions.map(position => Matrix4.multiplyByPoint(worldToLocal, cartesian(position), new Cartesian3()))
  let doubleArea = 0
  for (let index = 0; index < local.length; index++) {
    const next = local[(index + 1) % local.length]
    doubleArea += local[index].x * next.y - next.x * local[index].y
  }
  const value = Math.abs(doubleArea) / 2
  if (!Number.isFinite(value) || value <= 0) throw new Error('测量范围面积无效')
  return { kind: 'area', value, unit: 'm²', label: formatMeasurement(value, 'm²') }
}

/** Terrain-following distance. Ellipsoid scenes use geodesic distance without fake sampling. */
export async function measureGroundDistance(positions: readonly GeoPosition[], scene: Scene): Promise<SceneMeasurement> {
  requirePositions(positions, 2)
  const segments = positions.slice(1).map((position, index) => {
    const start = Cartographic.fromDegrees(...positions[index]), end = Cartographic.fromDegrees(...position)
    const geodesic = new EllipsoidGeodesic(start, end)
    return { geodesic, steps: Math.max(1, Math.ceil(geodesic.surfaceDistance / 30)) }
  })
  const totalSteps = segments.reduce((sum, segment) => sum + segment.steps, 0)
  if (totalSteps > 4096) throw new Error('贴地测量范围过大，请缩短路径或分段测量')
  const samples: Cartographic[] = []
  for (const { geodesic, steps } of segments) for (let step = 0; step <= steps; step++) {
    if (samples.length && step === 0) continue
    samples.push(geodesic.interpolateUsingFraction(step / steps, new Cartographic()))
  }
  const terrain = scene.terrainProvider as TerrainProvider
  const resolved = terrain.availability ? await sampleTerrainMostDetailed(terrain, samples) : samples
  let value = 0
  for (let index = 1; index < resolved.length; index++) value += Cartesian3.distance(Cartographic.toCartesian(resolved[index - 1]), Cartographic.toCartesian(resolved[index]))
  return { kind: 'ground-distance', value, unit: 'm', label: formatMeasurement(value, 'm') }
}

export function formatMeasurement(value: number, unit: SceneMeasurement['unit']): string {
  if (!Number.isFinite(value)) throw new Error('测量结果不是有限数值')
  const absolute = Math.abs(value)
  if (unit === 'm²' && absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} km²`
  if (unit === 'm' && absolute >= 1_000) return `${(value / 1_000).toFixed(2)} km`
  return `${value.toFixed(2)} ${unit}`
}
