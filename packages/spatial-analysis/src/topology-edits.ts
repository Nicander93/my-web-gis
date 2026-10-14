/// <reference path="./topology.d.ts" />
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js'
import OverlayOp from 'jsts/org/locationtech/jts/operation/overlay/OverlayOp.js'
import Polygonizer from 'jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js'
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js'
import type { LineString, MultiLineString, Polygon, MultiPolygon } from 'geojson'
import { checkGeometries } from './geometry-check.js'

type AreaGeometry = Polygon | MultiPolygon
type CutterGeometry = LineString | MultiLineString

function validateXY(geometry: AreaGeometry | CutterGeometry, id: string): void {
  const error = checkGeometries([{ id, geometry }]).issues[0]
  if (error) throw new Error(`${id}：${error.message}`)
  const positions = (value: unknown): void => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number') {
      if (value.length !== 2) throw new Error(`${id}：拓扑编辑仅支持二维坐标，高程/M 值不会被静默丢弃`)
    } else value.forEach(positions)
  }
  positions(geometry.coordinates)
}

/** Union valid XY polygons; overlaps and holes are resolved by the existing JTS engine. */
export function mergePolygonGeometries(geometries: readonly AreaGeometry[], onProgress?: (done: number, total: number) => void): AreaGeometry {
  if (geometries.length < 2) throw new Error('至少选择两个面要素')
  geometries.forEach((geometry, index) => validateXY(geometry, `面 ${index + 1}`))
  const reader = new GeoJSONReader(), writer = new GeoJSONWriter()
  try {
    let merged: unknown = reader.read(geometries[0])
    onProgress?.(1, geometries.length)
    for (let index = 1; index < geometries.length; index++) {
      merged = OverlayOp.union(merged, reader.read(geometries[index]))
      onProgress?.(index + 1, geometries.length)
    }
    const result = writer.write(merged)
    if (result.type !== 'Polygon' && result.type !== 'MultiPolygon') throw new Error('合并结果不是面')
    validateXY(result, '合并结果')
    if (reader.read(result).getArea() <= 0) throw new Error('合并结果面积为零')
    return result
  } catch (error) { throw new Error(`面合并失败：${error instanceof Error ? error.message : String(error)}`) }
}

/** Node boundary/cutter linework and polygonize its faces, preserving holes without a buffer gap. */
export function splitPolygonGeometry(geometry: AreaGeometry, cutter: CutterGeometry): Polygon[] | null {
  validateXY(geometry, '待分割面'); validateXY(cutter, '切割线')
  const reader = new GeoJSONReader(), writer = new GeoJSONWriter()
  try {
    const source = reader.read(geometry)
    const clipped = OverlayOp.intersection(source, reader.read(cutter))
    const graph = OverlayOp.union(source.getBoundary(), clipped)
    const polygonizer = new Polygonizer()
    polygonizer.add(graph)
    const candidates = polygonizer.getPolygons().toArray()
      .filter((face) => face.getArea() > 0 && RelateOp.relate(face, source).isWithin())
      .map((face) => ({ geometry: writer.write(face), area: face.getArea() }))
      .sort((a, b) => b.area - a.area || JSON.stringify(a.geometry).localeCompare(JSON.stringify(b.geometry)))
    const originalParts = geometry.type === 'Polygon' ? 1 : geometry.coordinates.length
    if (candidates.length <= originalParts) return null
    const sourceArea = source.getArea()
    const outputArea = candidates.reduce((sum, face) => sum + face.area, 0)
    if (!(sourceArea > 0) || Math.abs(sourceArea - outputArea) > sourceArea * 1e-8) throw new Error('面积守恒检查未通过')
    return candidates.map((face) => {
      if (face.geometry.type !== 'Polygon') throw new Error('分割结果不是面')
      validateXY(face.geometry, '分割结果')
      return face.geometry
    })
  } catch (error) { throw new Error(`面分割失败：${error instanceof Error ? error.message : String(error)}`) }
}
