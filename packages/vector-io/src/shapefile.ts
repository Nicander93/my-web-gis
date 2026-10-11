import { zip } from '@mapbox/shp-write'
import type { GeoJsonFeatureCollection } from '@desktop-webgis/scene-schema'
import shp from 'shpjs'
import { unzipSync } from 'fflate'
import { createCoordinateTransform } from './coordinate-transform.js'
import type { CrsInfo, ShapefileExportOptions, VectorImportResult, ShapefileImportResult, ShapefileLayerResult } from './types.js'

type ShpResult = GeoJsonFeatureCollection & { fileName?: string; crs?: { type?: string; properties?: { name?: string } } }

/** 
 * Parses a ZIP containing one or more Shapefiles, returning each as a separate layer.
 * 
 * shpjs already converts coordinates to EPSG:4326 (WGS84).
 * We preserve the original CRS info (from .prj) as sourceCrs metadata.
 * 
 * Encoding: shpjs reads .cpg files automatically. Manual encoding override is not currently supported.
 * 
 * This is the NEW API that preserves multiple shapefiles as separate layers.
 * For backward compatibility, the old importShapefile is kept below.
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

/** shpjs converts coordinates but omits PRJ metadata; read only projection entries. */
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
  // Only the root CRS authority, not an ellipsoid/unit/nested geographic authority.
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
