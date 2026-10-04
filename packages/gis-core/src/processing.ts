/// <reference path="./jsts-topology.d.ts" />
import { buffer } from '@turf/buffer'
import { centroid } from '@turf/centroid'
import { envelope } from '@turf/envelope'
import { flatten } from '@turf/flatten'
import { intersect } from '@turf/intersect'
import { difference } from '@turf/difference'
import { union } from '@turf/union'
import { booleanValid } from '@turf/boolean-valid'
import { kinks } from '@turf/kinks'
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js'
import { cloneValue } from './clone'
import { createId } from './id'
import type { Geometry, GisFeature, Position, PolygonGeometry, MultiPolygonGeometry } from './types'

export type OverlayTool = 'clip' | 'intersect' | 'difference'
export type ProcessingTool = 'buffer' | 'centroid' | 'envelope' | 'explode' | OverlayTool | 'dissolve' | 'extract-location' | 'summarize-location' | 'attribute-join' | 'spatial-join' | 'clip-lines'
export type GeometryProcessingOptions =
  | { tool: 'buffer'; distance: number; unit: 'meters' | 'kilometers' }
  | { tool: 'centroid' }
  | { tool: 'envelope' }
  | { tool: 'explode' }
  | { tool: OverlayTool }
  | { tool: 'dissolve'; field?: string }
  | { tool: 'extract-location'; predicate: 'intersects' | 'within' | 'disjoint' }

/** Serializable application requests; statistical algorithms are implemented by the analysis extension. */
export type ProcessingOptions = GeometryProcessingOptions
  | { tool: 'clip-lines' }
  | { tool: 'summarize-location'; predicate: 'intersects' | 'within'; field?: string; prefix: string }
  | { tool: 'attribute-join'; inputKey: string; joinKey: string; fields: string[]; prefix: string; mode: 'left' | 'inner' }
  | { tool: 'spatial-join'; predicate: 'intersects' | 'within'; fields: string[]; prefix: string; mode: 'left' | 'inner' }

export interface ProcessingResult {
  features: GisFeature[]
  inputCount: number
  overlayCount?: number
}

/** Provenance travels with a result dataset; it is descriptive, not a live dependency. */
export interface ProcessingRecord {
  options: ProcessingOptions
  sourceLayerId: string
  sourceLayerName: string
  scope: 'all' | 'filtered' | 'selected'
  inputCount: number
  outputCount: number
  completedAt: string
  overlay?: { layerId: string; layerName: string; scope: 'all' | 'filtered' | 'selected'; inputCount: number }
}

export function requiresOverlay(tool: ProcessingTool): boolean {
  return tool === 'clip-lines' || tool === 'clip' || tool === 'intersect' || tool === 'difference' || tool === 'extract-location' || tool === 'summarize-location' || tool === 'attribute-join' || tool === 'spatial-join'
}

export function requiresPolygon(tool: ProcessingTool): boolean {
  return tool === 'clip' || tool === 'intersect' || tool === 'difference' || tool === 'dissolve' || tool === 'summarize-location'
}

function positions(geometry: Geometry): Position[] {
  switch (geometry.type) {
    case 'Point': return [geometry.coordinates]
    case 'MultiPoint':
    case 'LineString': return geometry.coordinates
    case 'MultiLineString':
    case 'Polygon': return geometry.coordinates.flat()
    case 'MultiPolygon': return geometry.coordinates.flat(2)
  }
}

function longitudeSpan(coords: Position[]): number {
  let west = Infinity, east = -Infinity
  for (const [longitude] of coords) { west = Math.min(west, longitude); east = Math.max(east, longitude) }
  return east - west
}

function validateGeometry(feature: GisFeature): void {
  const coords = positions(feature.geometry)
  if (!coords.length || coords.some(p => p.length < 2 || !p.every(Number.isFinite) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)) {
    throw new Error(`要素 ${feature.id} 的坐标无效；空间处理需要 WGS84 经纬度数据。`)
  }
  const geometry = feature.geometry
  const lines = geometry.type === 'LineString' ? [geometry.coordinates]
    : geometry.type === 'MultiLineString' ? geometry.coordinates : []
  if (lines.some(line => line.length < 2)) throw new Error(`要素 ${feature.id} 的线至少需要两个顶点。`)
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  if (polygons.some(polygon => !polygon.length || polygon.some(ring => ring.length < 4 || ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]))) {
    throw new Error(`要素 ${feature.id} 的面环未闭合或顶点不足。`)
  }
}

type PolygonFeature = GisFeature & { geometry: PolygonGeometry | MultiPolygonGeometry }

function validatePolygon(feature: GisFeature): asserts feature is PolygonFeature {
  validateGeometry(feature)
  if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
    throw new Error(`要素 ${feature.id} 不是面；此工具仅支持 Polygon / MultiPolygon。`)
  }
  if (longitudeSpan(positions(feature.geometry)) > 180) throw new Error(`要素 ${feature.id} 跨越日期变更线，暂不支持面运算。`)
  if (!booleanValid(feature.geometry) || kinks(feature.geometry).features.length > 0) {
    throw new Error(`要素 ${feature.id} 的面几何无效或存在自相交，请先修复。`)
  }
  // Turf's basic validity predicate does not detect every hole/component containment case.
  // Reuse polygon operations to reject those cases instead of silently repairing input.
  const components: PolygonFeature[] = (feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates] : feature.geometry.coordinates).map(coordinates => ({
      id: feature.id, properties: {}, geometry: { type: 'Polygon', coordinates }
    }))
  for (const component of components) {
    const rings = (component.geometry as PolygonGeometry).coordinates
    const outer: PolygonFeature = { id: feature.id, properties: {}, geometry: { type: 'Polygon', coordinates: [rings[0]] } }
    const holes: PolygonFeature[] = rings.slice(1).map(ring => ({ id: feature.id, properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }))
    for (const hole of holes) {
      if (difference(polygonCollection([hole, outer]))) throw new Error(`要素 ${feature.id} 的孔洞位于外环之外。`)
    }
    for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
      if (intersect(polygonCollection([holes[i], holes[j]]))) throw new Error(`要素 ${feature.id} 的孔洞相互重叠。`)
    }
  }
  for (let i = 0; i < components.length; i++) for (let j = i + 1; j < components.length; j++) {
    if (intersect(polygonCollection([components[i], components[j]]))) throw new Error(`要素 ${feature.id} 的多面部件相互重叠。`)
  }
}

function polygonCollection(features: PolygonFeature[]) {
  return {
    type: 'FeatureCollection' as const,
    features: features.map(feature => ({ type: 'Feature' as const, geometry: feature.geometry, properties: {} }))
  }
}

function mergePolygons(features: PolygonFeature[]): PolygonGeometry | MultiPolygonGeometry {
  if (features.length === 1) return cloneValue(features[0].geometry)
  const merged = union(polygonCollection(features))
  if (!merged) throw new Error('面融合结果为空。')
  return merged.geometry as PolygonGeometry | MultiPolygonGeometry
}

function resultFeature(geometry: Geometry, properties: Record<string, unknown>, source?: GisFeature, overlay?: GisFeature): GisFeature {
  return {
    id: createId('feature'), geometry: cloneValue(geometry), properties: cloneValue(properties),
    metadata: { sourceId: source?.id, overlaySourceId: overlay?.id, sourceCrs: 'EPSG:4326' }
  }
}

/** Compare complete geometries against one merged region, including holes and multipart inputs. */
function extractByLocation(features: GisFeature[], options: Extract<ProcessingOptions, { tool: 'extract-location' }>, overlay: GisFeature[]): ProcessingResult {
  if (!overlay.length) throw new Error('第二输入范围没有面要素。')
  overlay.forEach(validatePolygon)
  const region = mergePolygons(overlay as PolygonFeature[])
  const reader = new GeoJSONReader()
  const mask = reader.read(region)
  const output: GisFeature[] = []
  for (const feature of features) {
    validateGeometry(feature)
    if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') validatePolygon(feature)
    if (longitudeSpan(positions(feature.geometry)) > 180) throw new Error(`要素 ${feature.id} 跨越日期变更线，暂不支持按位置提取。`)
    try {
      const relation = RelateOp.relate(reader.read(feature.geometry), mask)
      const matches = options.predicate === 'within' ? relation.isWithin()
        : options.predicate === 'disjoint' ? !relation.isIntersects() : relation.isIntersects()
      if (matches) output.push(resultFeature(feature.geometry, feature.properties, feature))
    } catch (error) {
      throw new Error(`要素 ${feature.id} 的空间关系计算失败：${error instanceof Error ? error.message : '请检查几何。'}`)
    }
  }
  return { features: output, inputCount: features.length, overlayCount: overlay.length }
}

function processPolygons(features: GisFeature[], options: GeometryProcessingOptions, overlay: GisFeature[]): ProcessingResult {
  features.forEach(validatePolygon)
  const input = features as PolygonFeature[]
  if (options.tool === 'dissolve') {
    if (options.field && !input.some(feature => Object.hasOwn(feature.properties, options.field!))) {
      throw new Error(`分组字段 ${options.field} 不存在。`)
    }
    const groups = new Map<string, { value: unknown; features: PolygonFeature[] }>()
    for (const feature of input) {
      const value = options.field ? feature.properties[options.field] ?? null : null
      if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        throw new Error(`字段 ${options.field} 包含复杂值，无法用于分组。`)
      }
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`字段 ${options.field} 包含无效数值。`)
      const key = JSON.stringify([typeof value, value])
      const group = groups.get(key)
      if (group) group.features.push(feature)
      else groups.set(key, { value, features: [feature] })
    }
    const output = Array.from(groups.values()).map(group => resultFeature(
      mergePolygons(group.features), options.field ? { [options.field]: group.value } : {}
    ))
    return { inputCount: input.length, features: output }
  }
  if (!requiresOverlay(options.tool)) throw new Error('未知面处理工具。')
  if (options.tool === 'extract-location') throw new Error('按位置提取应使用矢量处理入口。')
  if (!overlay.length) throw new Error('第二输入范围没有面要素。')
  overlay.forEach(validatePolygon)
  const masks = overlay as PolygonFeature[]
  const output: GisFeature[] = []
  if (options.tool === 'intersect') {
    for (const a of input) for (const b of masks) {
      const shared = intersect(polygonCollection([a, b]))
      if (!shared) continue
      const properties = Object.fromEntries([
        ...Object.entries(a.properties).map(([key, value]) => [`A_${key}`, value]),
        ...Object.entries(b.properties).map(([key, value]) => [`B_${key}`, value])
      ])
      output.push(resultFeature(shared.geometry as Geometry, properties, a, b))
    }
  } else {
    const mask: PolygonFeature = { id: 'mask', geometry: mergePolygons(masks), properties: {} }
    for (const feature of input) {
      const collection = polygonCollection([feature, mask])
      const result = options.tool === 'clip' ? intersect(collection) : difference(collection)
      if (result) output.push(resultFeature(result.geometry as Geometry, feature.properties, feature))
    }
  }
  return { features: output, inputCount: input.length, overlayCount: masks.length }
}

/** Pure WGS84 processing: results never share data with their inputs or mutate a project. */
export function processFeatures(features: GisFeature[], options: GeometryProcessingOptions, overlay: GisFeature[] = []): ProcessingResult {
  if (!features.length) throw new Error('当前处理范围没有要素。')
  if (options.tool === 'extract-location') return extractByLocation(features, options, overlay)
  if (requiresPolygon(options.tool)) return processPolygons(features, options, overlay)
  if (options.tool === 'buffer' && (!Number.isFinite(options.distance) || options.distance <= 0 || options.distance * (options.unit === 'kilometers' ? 1000 : 1) > 1000000)) {
    throw new Error('缓冲距离必须大于 0，且不超过 1000 千米。')
  }
  features.forEach(validateGeometry)
  if (options.tool === 'envelope') {
    const coords = features.flatMap(f => positions(f.geometry))
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
    for (const [x, y] of coords) {
      west = Math.min(west, x); east = Math.max(east, x)
      south = Math.min(south, y); north = Math.max(north, y)
    }
    if (west === east || south === north) throw new Error('输入范围退化为点或直线，无法生成面状外包矩形。')
    if (east - west > 180) throw new Error('当前外包矩形不支持跨越日期变更线的数据。')
    const bounds = envelope({ type: 'FeatureCollection', features: features.map(feature => ({ type: 'Feature', geometry: feature.geometry, properties: {} })) })
    return { inputCount: features.length, features: [resultFeature(bounds.geometry as Geometry, { input_count: features.length })] }
  }
  const output: GisFeature[] = []
  for (const feature of features) {
    let geometries: Geometry[]
    if (options.tool === 'explode') geometries = flatten(feature.geometry).features.map(part => part.geometry as Geometry)
    else if (options.tool === 'centroid') {
      if (longitudeSpan(positions(feature.geometry)) > 180) throw new Error(`要素 ${feature.id} 跨越日期变更线，暂不支持顶点质心。`)
      geometries = [centroid(feature.geometry).geometry as Geometry]
    }
    else if (options.tool === 'buffer') {
      const coords = positions(feature.geometry)
      if (coords.some(p => Math.abs(p[1]) > 85) || longitudeSpan(coords) > 180) {
        throw new Error(`要素 ${feature.id} 接近极区或跨越日期变更线，暂不支持缓冲。`)
      }
      const buffered = buffer(feature.geometry, options.distance, { units: options.unit, steps: 16 })
      if (!buffered) throw new Error(`要素 ${feature.id} 未能生成有效缓冲区。`)
      const resultCoords = positions(buffered.geometry as Geometry)
      if (resultCoords.some(p => Math.abs(p[1]) > 85) || longitudeSpan(resultCoords) > 180) throw new Error(`要素 ${feature.id} 的缓冲结果进入极区或跨越日期变更线，请减小距离。`)
      geometries = [buffered.geometry as Geometry]
    }
    else throw new Error('未知处理工具。')
    for (const geometry of geometries) output.push(resultFeature(geometry, feature.properties, feature))
  }
  return { features: output, inputCount: features.length }
}
