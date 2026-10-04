/// <reference path="./topology.d.ts" />
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js'
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js'

export interface GeometryCheckInput { id: string; geometry: unknown }

export interface GeometryIssue {
  featureId: string
  inputIndex: number
  status: 'invalid' | 'unsupported'
  code: string
  message: string
  location: [number, number] | null
}

export interface GeometryCheckReport {
  checked: number
  valid: number
  invalid: number
  unsupported: number
  issues: GeometryIssue[]
}

const topologyErrors = [
  ['topology-error', '拓扑无效'], ['repeated-point', '重复坐标点'],
  ['hole-outside-shell', '孔洞位于外环之外'], ['nested-holes', '孔洞互相嵌套'],
  ['disconnected-interior', '面内部不连通'], ['self-intersection', '几何自相交'],
  ['ring-self-intersection', '面环自相交'], ['nested-shells', '面外环互相嵌套'],
  ['duplicate-rings', '重复面环'], ['too-few-points', '不同坐标点数量不足'],
  ['invalid-coordinate', '坐标无效'], ['ring-not-closed', '面环未闭合']
]

/** Report the first issue per feature without mutating inputs; unsupported inputs are never counted as valid. */
export function checkGeometries(features: readonly GeometryCheckInput[]): GeometryCheckReport {
  const report: GeometryCheckReport = { checked: features.length, valid: 0, invalid: 0, unsupported: 0, issues: [] }
  const reader = new GeoJSONReader()
  features.forEach((feature, inputIndex) => {
    const base = { featureId: feature.id, inputIndex }
    const contract = checkCoordinates(feature.geometry)
    if (contract) {
      report[contract.status]++
      report.issues.push({ ...base, ...contract })
      return
    }
    try {
      const validation = new IsValidOp(reader.read(feature.geometry))
      const error = validation.getValidationError()
      if (!error) { report.valid++; return }
      const [code, message] = topologyErrors[error.getErrorType()] ?? topologyErrors[0]
      const coordinate = error.getCoordinate()
      const location: [number, number] | null = coordinate && Number.isFinite(coordinate.x) && Number.isFinite(coordinate.y) ? [coordinate.x, coordinate.y] : null
      report.invalid++
      report.issues.push({ ...base, status: 'invalid', code, message, location })
    } catch {
      report.invalid++
      report.issues.push({ ...base, status: 'invalid', code: 'invalid-structure', message: '几何结构无法解析', location: null })
    }
  })
  return report
}

function checkCoordinates(geometry: unknown): Omit<GeometryIssue, 'featureId' | 'inputIndex'> | null {
  const issue = (code: string, message: string, status: GeometryIssue['status'] = 'invalid', location: [number, number] | null = null) => ({ code, message, status, location })
  if (!geometry || typeof geometry !== 'object' || !('type' in geometry)) return issue('invalid-structure', '缺少几何类型')
  const type = geometry.type
  if (!['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(String(type))) return issue('unsupported-type', '不支持此几何类型', 'unsupported')
  if (!('coordinates' in geometry)) return issue('invalid-structure', '缺少坐标')
  let west = Infinity, east = -Infinity
  let failure: ReturnType<typeof issue> | null = null
  const position = (value: unknown): boolean => {
    if (!Array.isArray(value) || value.length < 2 || !value.every(v => typeof v === 'number' && Number.isFinite(v))) {
      failure = issue('invalid-coordinate', '坐标必须包含至少两个有限数值'); return false
    }
    if (Math.abs(value[0]) > 180 || Math.abs(value[1]) > 90) {
      failure = issue('coordinate-range', '坐标超出 WGS84 经纬度范围'); return false
    }
    west = Math.min(west, value[0]); east = Math.max(east, value[0])
    return true
  }
  const sequence = (value: unknown, ring: boolean): boolean => {
    if (!Array.isArray(value) || value.length < (ring ? 4 : 2)) { failure = issue('too-few-points', ring ? '面环至少需要四个坐标' : '线至少需要两个坐标'); return false }
    if (!value.every(position)) return false
    if (ring && (value[0][0] !== value.at(-1)[0] || value[0][1] !== value.at(-1)[1])) {
      failure = issue('ring-not-closed', '面环未闭合', 'invalid', [value[0][0], value[0][1]]); return false
    }
    return true
  }
  const collection = (value: unknown, check: (item: unknown) => boolean): boolean => {
    if (!Array.isArray(value) || !value.length) { failure = issue('empty-geometry', '几何坐标为空'); return false }
    return value.every(check)
  }
  const polygon = (value: unknown) => collection(value, item => sequence(item, true))
  const coordinates = geometry.coordinates
  if (type === 'Point') position(coordinates)
  else if (type === 'MultiPoint') collection(coordinates, position)
  else if (type === 'LineString') sequence(coordinates, false)
  else if (type === 'MultiLineString') collection(coordinates, item => sequence(item, false))
  else if (type === 'Polygon') polygon(coordinates)
  else collection(coordinates, polygon)
  if (failure) return failure
  return east - west > 180 ? issue('antimeridian', '跨日期变更线的几何暂不支持', 'unsupported') : null
}
