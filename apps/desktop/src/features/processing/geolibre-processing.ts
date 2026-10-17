import { createId, type GisFeature, type ProcessingOptions, type ProcessingResult } from '@desktop-webgis/gis-core'
import { checkGeometries } from '@desktop-webgis/spatial-analysis'
import { runTool } from 'geolibre-wasm/tools'

const engine = { id: 'geolibre-wasm', version: '1.7.1', tool: 'simplify_features' }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validGeometry(value: unknown): value is GisFeature['geometry'] {
  return checkGeometries([{ id: 'output', geometry: value }]).valid === 1
}

function normalizeGeometry(value: Record<string, unknown>, expected: GisFeature['geometry']['type']): unknown {
  // The upstream vector driver serializes multipart features as homogeneous collections.
  if (value.type !== 'GeometryCollection' || !Array.isArray(value.geometries)) return value
  const partType = expected === 'MultiLineString' ? 'LineString' : expected === 'MultiPolygon' ? 'Polygon' : null
  if (!partType || !value.geometries.every(part => record(part) && part.type === partType)) return value
  return { type: expected, coordinates: value.geometries.map(part => part.coordinates) }
}

function requireXY(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('几何坐标结构无效。')
  if (typeof value[0] === 'number') {
    if (value.length !== 2) throw new Error('首版几何简化仅支持二维 XY；含 Z/M 的数据未处理，原数据不变。')
  } else value.forEach(requireXY)
}

function validate(features: GisFeature[]): void {
  const report = checkGeometries(features)
  if (report.valid !== features.length) throw new Error(`几何简化拒绝无效或不支持的几何：${report.issues[0]?.message ?? '几何无效'}`)
  for (const feature of features) {
    if (!['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(feature.geometry.type)) throw new Error('几何简化仅支持线和面图层。')
    requireXY(feature.geometry.coordinates)
  }
}

/** Reuses the official WASI algorithm; project attributes never pass through its file drivers. */
export async function simplifyFeatures(features: GisFeature[], options: Extract<ProcessingOptions, { tool: 'simplify' }>): Promise<ProcessingResult> {
  if (options.unit !== 'degrees' || !Number.isFinite(options.tolerance) || options.tolerance <= 0 || options.tolerance > 180) throw new Error('简化容差必须大于 0 且不超过 180 度。')
  if (!features.length) throw new Error('当前处理范围没有要素。')
  validate(features)
  const input = { type: 'FeatureCollection', features: features.map((feature, index) => ({
    type: 'Feature', geometry: feature.geometry, properties: { source_index: index }
  })) }
  const result = await runTool(engine.tool, {
    args: ['--input=/work/input.geojson', '--output=/work/output.geojson', `--tolerance=${options.tolerance}`],
    input: { 'input.geojson': new TextEncoder().encode(JSON.stringify(input)) }
  })
  if (result.exitCode !== 0) throw new Error(`GeoLibre 几何简化失败（${result.exitCode}）：${result.stdout.join('\n').slice(-2000)}`)
  const bytes = result.files['output.geojson']
  if (!bytes) throw new Error('GeoLibre 未返回简化结果。')
  const output: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!record(output) || output.type !== 'FeatureCollection' || !Array.isArray(output.features) || output.features.length !== features.length) throw new Error('简化改变了要素数量，未提交部分结果。请减小容差。')
  const mapped = new Map<number, GisFeature>()
  for (const item of output.features) {
    if (!record(item) || item.type !== 'Feature' || !record(item.properties) || !record(item.geometry)) throw new Error('简化输出结构无效，未添加结果。')
    const index = item.properties.source_index
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= features.length || mapped.has(index)) throw new Error('简化输出无法唯一对应输入，未添加结果。')
    const original = features[index]
    const geometry = normalizeGeometry(item.geometry, original.geometry.type)
    if (!validGeometry(geometry)) throw new Error('简化结果无效，未添加结果。请减小容差。')
    if (geometry.type !== original.geometry.type) throw new Error('简化改变了几何类型，未添加结果。请减小容差。')
    const feature = structuredClone(original)
    feature.id = createId('feature')
    feature.geometry = structuredClone(geometry)
    feature.metadata = { ...feature.metadata, sourceId: original.id }
    mapped.set(index, feature)
  }
  const simplified = features.map((_, index) => mapped.get(index)!)
  validate(simplified)
  return { inputCount: features.length, features: simplified, engine: { ...engine } }
}
