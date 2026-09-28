import DxfParser from 'dxf-parser'
import type {
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GeoJsonGeometry,
  JsonValue
} from '@desktop-webgis/scene-schema'
import type {
  DxfDocumentLike,
  DxfEntity,
  DxfImportOptions,
  DxfPoint,
  VectorImportResult
} from './types.js'

/** Parses ASCII DXF. Binary DXF and DWG are deliberately outside this adapter's boundary. */
export function importDxf(text: string, options: DxfImportOptions = {}): VectorImportResult {
  const document = new DxfParser().parseSync(text) as DxfDocumentLike | null
  if (!document) throw new Error('DXF 内容为空或无法解析。')
  return dxfDocumentToGeoJson(document, options)
}

export function dxfDocumentToGeoJson(
  document: DxfDocumentLike,
  options: DxfImportOptions = {}
): VectorImportResult {
  const features: GeoJsonFeature[] = []
  const unsupported = new Map<string, number>()
  document.entities.forEach((entity, index) => {
    const geometry = entityToGeometry(entity, options)
    if (!geometry) {
      unsupported.set(entity.type, (unsupported.get(entity.type) ?? 0) + 1)
      return
    }
    features.push({
      type: 'Feature',
      id: entity.handle ?? `dxf-${index + 1}`,
      geometry,
      properties: entityProperties(entity)
    })
  })
  
  const warnings = Array.from(unsupported, ([type, count]) => ({
    code: 'dxf.unsupportedEntity',
    message: `暂未转换 DXF 实体 ${type}。`,
    count
  }))
  
  if (!options.crs) {
    warnings.push({
      code: 'dxf.unknownCrs',
      message: 'DXF 文件未包含坐标系信息,需要用户指定。',
      count: 1
    })
  }
  
  return {
    featureCollection: { type: 'FeatureCollection', features },
    crs: options.crs,
    warnings
  }
}

function entityToGeometry(entity: DxfEntity, options: DxfImportOptions): GeoJsonGeometry | null {
  if (entity.type === 'POINT' && entity.position) {
    return { type: 'Point', coordinates: position(entity.position, options) }
  }
  if (entity.type === 'TEXT' || entity.type === 'MTEXT') {
    const anchor = entity.position ?? entity.vertices?.[0]
    return anchor ? { type: 'Point', coordinates: position(anchor, options) } : null
  }
  if (entity.type === 'LINE') return lineFromPoints(entity.vertices, options)
  if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
    return polylineGeometry(entity, options)
  }
  if (entity.type === 'SPLINE') return lineFromPoints(entity.controlPoints, options)
  if (entity.type === 'CIRCLE' && entity.center && positive(entity.radius)) {
    return curveGeometry(entity.center, entity.radius, 0, Math.PI * 2, true, options)
  }
  if (
    entity.type === 'ARC' &&
    entity.center &&
    positive(entity.radius) &&
    finite(entity.startAngle) &&
    finite(entity.endAngle)
  ) {
    return curveGeometry(entity.center, entity.radius, entity.startAngle, entity.endAngle, false, options)
  }
  return null
}

function polylineGeometry(entity: DxfEntity, options: DxfImportOptions): GeoJsonGeometry | null {
  const points = entity.vertices?.map((point) => position(point, options)) ?? []
  if (points.length < 2) return null
  const closed = entity.shape === true || Boolean((entity.flags ?? 0) & 1)
  if (!closed || points.length < 3) return { type: 'LineString', coordinates: points }
  const ring = closeRing(points)
  return { type: 'Polygon', coordinates: [ring] }
}

function lineFromPoints(points: DxfPoint[] | undefined, options: DxfImportOptions): GeoJsonGeometry | null {
  if (!points || points.length < 2) return null
  return { type: 'LineString', coordinates: points.map((point) => position(point, options)) }
}

function curveGeometry(
  center: DxfPoint,
  radius: number,
  startAngle: number,
  endAngle: number,
  closed: boolean,
  options: DxfImportOptions
): GeoJsonGeometry {
  const segmentCount = Math.max(8, Math.min(256, Math.round(options.curveSegments ?? 64)))
  let end = endAngle
  while (end <= startAngle) end += Math.PI * 2
  const points = Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = startAngle + ((end - startAngle) * index) / segmentCount
    return position(
      { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) },
      options
    )
  })
  return closed
    ? { type: 'Polygon', coordinates: [closeRing(points)] }
    : { type: 'LineString', coordinates: points }
}

function position(point: DxfPoint, options: DxfImportOptions): number[] {
  const pair: [number, number] = [point.x, point.y]
  const transformed = options.transform?.(pair) ?? pair
  return point.z === undefined ? transformed : [transformed[0], transformed[1], point.z]
}

function closeRing(points: number[][]): number[][] {
  const first = points[0]
  const last = points.at(-1)
  if (!first || !last) return points
  return first[0] === last[0] && first[1] === last[1] ? points : [...points, [...first]]
}

function entityProperties(entity: DxfEntity): Record<string, JsonValue> {
  return {
    entityType: entity.type,
    ...(entity.layer ? { layer: entity.layer } : {}),
    ...(entity.handle ? { handle: entity.handle } : {}),
    ...(typeof entity.text === 'string' ? { text: entity.text } : {})
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0
}
