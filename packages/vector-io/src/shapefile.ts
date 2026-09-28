import { zip } from '@mapbox/shp-write'
import type { GeoJsonFeatureCollection } from '@desktop-webgis/scene-schema'
import shp from 'shpjs'
import type { CrsInfo, ShapefileExportOptions, VectorImportResult, ShapefileImportResult, ShapefileLayerResult } from './types.js'

type ShpResult = GeoJsonFeatureCollection & { fileName?: string; crs?: { type?: string; properties?: { name?: string } } }

/** 
 * Parses a ZIP containing one or more Shapefiles, returning each as a separate layer.
 * 
 * shpjs already converts coordinates to EPSG:4326 (WGS84).
 * We preserve the original CRS info (from .prj) as sourceCrs metadata.
 * 
 * This is the NEW API that preserves multiple shapefiles as separate layers.
 * For backward compatibility, the old importShapefile is kept below.
 */
export async function importShapefileZipLayers(
  input: ArrayBuffer | ArrayBufferView,
  options?: { encoding?: string }
): Promise<ShapefileImportResult> {
  const parsed = (await shp(input)) as ShpResult | ShpResult[]
  const collections = Array.isArray(parsed) ? parsed : [parsed]
  
  const layers: ShapefileLayerResult[] = collections.map((collection, index) => {
    const crsInfo = extractCrsInfo(collection)
    const warnings: ShapefileLayerResult['warnings'] = []
    
    const hasPrj = collection.crs !== undefined
    const fileName = collection.fileName ?? `layer-${index + 1}`
    
    if (!hasPrj) {
      warnings.push({
        code: 'shapefile.missingPrj',
        message: '缺少 .prj 文件，假定为 WGS84 (EPSG:4326)'
      })
    }
    
    if (options?.encoding) {
      warnings.push({
        code: 'shapefile.encodingOverride',
        message: `已指定编码: ${options.encoding}（注意：shpjs 库会自动处理编码，手动覆盖可能无效）`
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
 * @deprecated Use importShapefileZipLayers for new code. This function merges all layers.
 * 
 * Parses a ZIP (or shpjs-compatible binary) and normalizes multiple SHP layers into one collection.
 * 
 * shpjs already converts coordinates to EPSG:4326 (WGS84).
 * We preserve the original CRS info (from .prj) as sourceCrs metadata.
 */
export async function importShapefile(
  input: ArrayBuffer | ArrayBufferView
): Promise<VectorImportResult> {
  const parsed = (await shp(input)) as ShpResult | ShpResult[]
  const collections = Array.isArray(parsed) ? parsed : [parsed]
  const sourceLayers = collections.map((collection, index) => collection.fileName ?? `layer-${index + 1}`)
  
  const crsInfo = extractCrsInfo(collections[0])
  const warnings: VectorImportResult['warnings'] = []
  
  if (collections.length > 1) {
    warnings.push({ 
      code: 'shapefile.multipleLayers', 
      message: 'ZIP 中包含多个 Shapefile，已合并为一个要素集合。',
      count: collections.length
    })
  }
  
  return {
    featureCollection: {
      type: 'FeatureCollection',
      features: collections.flatMap((collection) => collection.features)
    },
    sourceLayers,
    crs: crsInfo.output,
    sourceCrs: crsInfo.original,
    warnings
  }
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

/** Writes GeoJSON to a ZIP containing SHP/SHX/DBF/PRJ files. */
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
