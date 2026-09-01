import { zip } from '@mapbox/shp-write'
import type { GeoJsonFeatureCollection } from '@desktop-webgis/scene-schema'
import shp from 'shpjs'
import type { ShapefileExportOptions, VectorImportResult } from './types.js'

type ShpResult = GeoJsonFeatureCollection & { fileName?: string }

/** Parses a ZIP (or shpjs-compatible binary) and normalizes multiple SHP layers into one collection. */
export async function importShapefile(
  input: ArrayBuffer | ArrayBufferView
): Promise<VectorImportResult> {
  const parsed = (await shp(input)) as ShpResult | ShpResult[]
  const collections = Array.isArray(parsed) ? parsed : [parsed]
  const sourceLayers = collections.map((collection, index) => collection.fileName ?? `layer-${index + 1}`)
  return {
    featureCollection: {
      type: 'FeatureCollection',
      features: collections.flatMap((collection) => collection.features)
    },
    sourceLayers,
    warnings:
      collections.length > 1
        ? [{ code: 'shapefile.multipleLayers', message: 'ZIP 中包含多个 Shapefile，已合并为一个要素集合。' }]
        : []
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
