import { zip } from '@mapbox/shp-write'
import type { GeoJsonFeatureCollection } from './types.js'
import shp from 'shpjs'
import { unzipSync } from 'fflate'
import { createCoordinateTransform } from './coordinate-transform.js'
import type { CrsInfo, ShapefileExportOptions, VectorImportResult, ShapefileImportResult, ShapefileLayerResult } from './types.js'

type ShpResult = GeoJsonFeatureCollection & { fileName?: string; crs?: { type?: string; properties?: { name?: string } } }

/** 
 * 解析包含一个或多个 Shapefile 的 ZIP，每个都作为独立的图层返回。
 * 
 * shpjs 已经把坐标转换成 EPSG:4326（WGS84）了。
 * 把原始的 CRS 信息（来自 .prj）保留为 sourceCrs 元数据。
 * 
 * 编码：shpjs 会自动读取 .cpg 文件，目前不支持手动指定编码。
 * 
 * 这是新的 API，会把多个 shapefile 保留为各自独立的图层。
 * 为了向后兼容，下面保留了旧的 importShapefile。
 */
export async function importShapefileZipLayers(
  input: ArrayBuffer | ArrayBufferView
): Promise<ShapefileImportResult> {
  const projections = readProjectionFiles(input)
  for (const [name, wkt] of projections) {
    if (!wkt || !createCoordinateTransform({ wkt }).success) throw new Error(`Shapefile 投影定义无效：${name}.prj`)
  }
  const parsed = (await shp(input)) as ShpResult | ShpResult[]
  const collections = Array.isArray(parsed) ? parsed : [parsed]
  
  const layers: ShapefileLayerResult[] = collections.map((collection, index) => {
    const projection = projections.get((collection.fileName ?? '').replaceAll('\\', '/').toLowerCase())
    const crsInfo = projection ? projectionCrsInfo(projection) : extractCrsInfo(collection)
    const warnings: ShapefileLayerResult['warnings'] = []
    
    const hasPrj = projection !== undefined || collection.crs !== undefined
    const fileName = collection.fileName ?? `layer-${index + 1}`
    
    if (!hasPrj) {
      warnings.push({
        code: 'shapefile.missingPrj',
        message: '缺少 .prj 文件，假定为 WGS84 (EPSG:4326)'
      })
    }
    
    return {
      name: fileName,
      featureCollection: {
        type: 'FeatureCollection',
        features: collection.features
      },
      crs: crsInfo.output,
      sourceCrs: crsInfo.original,
      hasPrj,
      warnings
    }
  })
  
  return { layers }
}

/** 
 * @deprecated 新代码请使用 importShapefileZipLayers，这个函数会把所有图层合并成一层。
 * 
 * 解析 ZIP（或 shpjs 兼容的二进制），把多个 SHP 图层规范化为一个集合。
 * 
 * shpjs 已经把坐标转换成 EPSG:4326（WGS84）了。
 * 把原始的 CRS 信息（来自 .prj）保留为 sourceCrs 元数据。
 */
export async function importShapefile(
  input: ArrayBuffer | ArrayBufferView
): Promise<VectorImportResult> {
  const result = await importShapefileZipLayers(input)
  const sourceLayers = result.layers.map(layer => layer.name)
  const warnings: VectorImportResult['warnings'] = []
  
  if (result.layers.length > 1) {
    warnings.push({ 
      code: 'shapefile.multipleLayers', 
      message: 'ZIP 中包含多个 Shapefile，已合并为一个要素集合。',
      count: result.layers.length
    })
  }
  
  return {
    featureCollection: {
      type: 'FeatureCollection',
      features: result.layers.flatMap(layer => layer.featureCollection.features)
    },
    sourceLayers,
    crs: result.layers[0]?.crs,
    sourceCrs: result.layers[0]?.sourceCrs,
    warnings: [...result.layers.flatMap(layer => layer.warnings), ...warnings]
  }
}

/** shpjs 会转换坐标但不保留 PRJ 元数据；这里只读取投影相关的条目。 */
function readProjectionFiles(input: ArrayBuffer | ArrayBufferView): Map<string, string> {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return new Map()
  const entries = unzipSync(bytes, { filter: entry => {
    if (!entry.name.toLowerCase().endsWith('.prj')) return false
    if (entry.originalSize > 65536) throw new Error('Shapefile 投影定义过大')
    return true
  } })
  return new Map(Object.entries(entries).map(([name, content]) => [
    name.replaceAll('\\', '/').slice(0, -4).toLowerCase(), new TextDecoder().decode(content).trim()
  ]))
}

function projectionCrsInfo(wkt: string): { output: CrsInfo; original: CrsInfo } {
  // 只取 CRS 的根授权名，不取椭球、单位或嵌套的地理授权名。
  const code = wkt.match(/(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]\s*\]\s*$/i)?.[1]
  return { output: { code: 'EPSG:4326' }, original: { ...(code ? { code: `EPSG:${code}` } : {}), wkt } }
}

function extractCrsInfo(collection: ShpResult | undefined): { 
  output?: CrsInfo; 
  original?: CrsInfo 
} {
  if (!collection?.crs) {
    return { output: { code: 'EPSG:4326' } }
  }
  
  const crsName = collection.crs.properties?.name
  if (typeof crsName === 'string') {
    const epsgMatch = crsName.match(/EPSG[:/](\d+)/i)
    if (epsgMatch) {
      const code = `EPSG:${epsgMatch[1]}`
      return {
        output: { code: 'EPSG:4326' },
        original: { code }
      }
    }
  }
  
  return { 
    output: { code: 'EPSG:4326' },
    original: crsName ? { wkt: crsName } : undefined
  }
}

/** 把 GeoJSON 写出成包含 SHP、SHX、DBF、PRJ 文件的 ZIP。 */
export async function exportShapefile(
  featureCollection: GeoJsonFeatureCollection,
  options: ShapefileExportOptions = {}
): Promise<Uint8Array> {
  const output = await Promise.resolve(
    zip(featureCollection, {
      folder: options.folder ?? 'shapes',
      filename: options.filename ?? 'shapes',
      outputType: 'arraybuffer',
      compression: 'STORE',
      ...(options.prj ? { prj: options.prj } : {}),
      ...(options.types ? { types: options.types } : {})
    })
  )
  if (output instanceof ArrayBuffer) return new Uint8Array(output)
  if (ArrayBuffer.isView(output)) {
    return new Uint8Array(output.buffer, output.byteOffset, output.byteLength)
  }
  throw new Error('Shapefile 导出器返回了不支持的二进制格式。')
}
