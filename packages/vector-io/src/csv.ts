import Papa from 'papaparse'
import type { GeoJsonFeatureCollection, GeoJsonFeature } from '@desktop-webgis/scene-schema'
import type { VectorImportResult, VectorImportWarning, CrsInfo } from './types.js'

export interface CsvImportOptions {
  xField: string
  yField: string
  crs: CrsInfo
  delimiter?: string
}

export interface CsvPreviewResult {
  /** A uniform EPSG declaration in the optional `crs` column, checked across all rows. */
  declaredCrs?: string
  totalRows: number
  validRows: number
  invalidRows: number
  fields: string[]
  sampleRows: Record<string, string>[]
  errors: Array<{ row: number; reason: string }>
}

export function previewCsv(content: string, options?: { xField?: string; yField?: string; crs?: CrsInfo }): CsvPreviewResult {
  const stripBom = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  
  const parseResult = Papa.parse<Record<string, string>>(stripBom, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    delimiter: '',
    delimitersToGuess: [',', ';', '\t']
  })

  const fields = parseResult.meta.fields || []
  const totalRows = parseResult.data.length
  const sampleRows = parseResult.data.slice(0, 5)
  const declarations = new Set(parseResult.data.map(row => row.crs?.trim().toUpperCase()).filter(value => value && /^EPSG:\d+$/.test(value)))
  const declaredCrs = declarations.size === 1 ? [...declarations][0] : undefined

  if (!options?.xField || !options?.yField) {
    return {
      totalRows,
      validRows: 0,
      invalidRows: 0,
      fields,
      sampleRows,
      declaredCrs,
      errors: []
    }
  }

  const { xField, yField, crs } = options
  const errors: Array<{ row: number; reason: string }> = []
  let validCount = 0

  for (let i = 0; i < parseResult.data.length; i++) {
    const row = parseResult.data[i]
    const rowNumber = i + 2
    const declared = row?.crs?.trim().toUpperCase()
    if (declared && /^EPSG:\d+$/.test(declared) && crs?.code && declared !== crs.code.toUpperCase()) {
      errors.push({ row: rowNumber, reason: `crs 列声明 ${declared}，与所选坐标系冲突` })
      continue
    }

    if (!row || Object.keys(row).every(k => row[k] === '')) {
      continue
    }

    const xValue = row[xField]
    const yValue = row[yField]

    if (xValue === undefined || yValue === undefined) {
      errors.push({ row: rowNumber, reason: '缺失坐标字段' })
      continue
    }

    const x = xValue.trim() ? Number(xValue.trim()) : NaN
    const y = yValue.trim() ? Number(yValue.trim()) : NaN

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      errors.push({ row: rowNumber, reason: '坐标值无效 (非数字或非有限值)' })
      continue
    }

    if (crs?.code === 'EPSG:4326') {
      if (y < -90 || y > 90) {
        errors.push({ row: rowNumber, reason: `纬度超出范围: ${y}` })
        continue
      }
      if (x < -180 || x > 180) {
        errors.push({ row: rowNumber, reason: `经度超出范围: ${x}` })
        continue
      }
    }

    validCount++
  }

  return {
    totalRows,
    validRows: validCount,
    invalidRows: errors.length,
    fields,
    sampleRows,
    declaredCrs,
    errors
  }
}

export function importCsv(
  content: string,
  options: CsvImportOptions
): VectorImportResult {
  const { xField, yField, crs } = options
  const warnings: VectorImportWarning[] = []
  
  const stripBom = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
  
  const parseResult = Papa.parse<Record<string, string>>(stripBom, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
    delimiter: options.delimiter || '',
    delimitersToGuess: [',', ';', '\t']
  })

  if (parseResult.errors.length > 0) {
    const parseErrors = parseResult.errors
      .filter(e => e.type === 'Quotes' || e.type === 'FieldMismatch')
      .slice(0, 5)
    if (parseErrors.length > 0) {
      warnings.push({
        code: 'CSV_PARSE_WARNING',
        message: `CSV 解析警告: ${parseErrors.map(e => `行 ${e.row}: ${e.message}`).join('; ')}`
      })
    }
  }

  const features: GeoJsonFeature[] = []
  const invalidRows: Array<{ row: number; reason: string }> = []
  const rows = parseResult.data
  for (let i = 0; i < rows.length; i++) {
    const declared = rows[i]?.crs?.trim().toUpperCase()
    if (declared && /^EPSG:\d+$/.test(declared) && declared !== crs.code?.toUpperCase()) throw new Error(`第 ${i + 2} 行 crs 列声明 ${declared}，与所选坐标系冲突。`)
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 2

    if (!row || Object.keys(row).every(k => row[k] === '')) {
      continue
    }

    const xValue = row[xField]
    const yValue = row[yField]

    if (xValue === undefined || yValue === undefined) {
      invalidRows.push({ row: rowNumber, reason: '缺失坐标字段' })
      continue
    }

    const x = xValue.trim() ? Number(xValue.trim()) : NaN
    const y = yValue.trim() ? Number(yValue.trim()) : NaN

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      invalidRows.push({ row: rowNumber, reason: '坐标值无效 (非数字或非有限值)' })
      continue
    }

    if (crs.code === 'EPSG:4326') {
      if (y < -90 || y > 90) {
        invalidRows.push({ row: rowNumber, reason: `纬度超出范围: ${y}` })
        continue
      }
      if (x < -180 || x > 180) {
        invalidRows.push({ row: rowNumber, reason: `经度超出范围: ${x}` })
        continue
      }
    }

    const properties: Record<string, string> = {}
    for (const key of Object.keys(row)) {
      if (key !== xField && key !== yField) {
        properties[key] = row[key]
      }
    }

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [x, y]
      },
      properties
    })
  }

  if (invalidRows.length > 0) {
    const displayCount = Math.min(invalidRows.length, 5)
    const errorSummary = invalidRows.slice(0, displayCount)
      .map(e => `行 ${e.row}: ${e.reason}`)
      .join('; ')
    const moreText = invalidRows.length > displayCount 
      ? ` (还有 ${invalidRows.length - displayCount} 行错误)` 
      : ''
    
    warnings.push({
      code: 'CSV_INVALID_ROWS',
      message: `跳过 ${invalidRows.length} 行无效记录: ${errorSummary}${moreText}`,
      count: invalidRows.length
    })
  }

  const featureCollection: GeoJsonFeatureCollection = {
    type: 'FeatureCollection',
    features
  }

  return {
    featureCollection,
    warnings,
    crs
  }
}
