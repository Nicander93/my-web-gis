/**
 * CSV attribute export with RFC4180 escaping and optional spreadsheet formula guard.
 *
 * Formula guard (default on): values whose string form starts with = + - @ \t or \r
 * are prefixed with a single quote so common spreadsheet apps treat them as text.
 * GeoJSON export must NOT use this — keep original property strings there.
 */

export interface CsvExportFeature {
  id?: string | number
  properties?: Record<string, unknown> | null
  geometry?: {
    type: string
    coordinates: unknown
  } | null
}

export interface CsvWriteOptions {
  /** Column delimiter. Default `,`. */
  delimiter?: string
  /**
   * Prefix spreadsheet formula-like values with `'`.
   * Default `true`. Documented in the export dialog help text.
   */
  formulaGuard?: boolean
  /** Include feature `id` as the first column. Default `true`. */
  includeId?: boolean
  /** Extra geometry columns for Point features: `x`, `y`. Default `false`. */
  includePointXY?: boolean
}

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/

export function needsFormulaGuard(value: string): boolean {
  return FORMULA_PREFIX_RE.test(value)
}

export function guardSpreadsheetFormula(value: string): string {
  return needsFormulaGuard(value) ? `'${value}` : value
}

export function escapeCsvField(value: string, delimiter = ','): string {
  const mustQuote =
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    value.includes(delimiter)
  if (!mustQuote) return value
  return `"${value.replace(/"/g, '""')}"`
}

function cellString(raw: unknown, formulaGuard: boolean): string {
  if (raw === null || raw === undefined) return ''
  let text: string
  if (typeof raw === 'string') text = raw
  else if (typeof raw === 'number' || typeof raw === 'boolean') text = String(raw)
  else text = JSON.stringify(raw)
  return formulaGuard ? guardSpreadsheetFormula(text) : text
}

/** Collect stable union of property keys across features (sorted). */
export function collectCsvFields(features: CsvExportFeature[]): string[] {
  const keys = new Set<string>()
  for (const feature of features) {
    for (const key of Object.keys(feature.properties ?? {})) keys.add(key)
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b))
}

/**
 * Serialize features to an attribute CSV string.
 * Empty feature list returns `null` so callers can refuse to write a misleading file.
 */
export function featuresToCsv(
  features: CsvExportFeature[],
  options: CsvWriteOptions = {}
): string | null {
  if (features.length === 0) return null

  const delimiter = options.delimiter ?? ','
  const formulaGuard = options.formulaGuard !== false
  const includeId = options.includeId !== false
  const includePointXY = options.includePointXY === true

  const propFields = collectCsvFields(features)
  const header: string[] = []
  if (includeId) header.push('id')
  if (includePointXY) {
    header.push('x', 'y')
  }
  header.push(...propFields)

  const lines: string[] = [
    header.map((h) => escapeCsvField(cellString(h, false), delimiter)).join(delimiter)
  ]

  for (const feature of features) {
    const row: string[] = []
    if (includeId) {
      row.push(escapeCsvField(cellString(feature.id, formulaGuard), delimiter))
    }
    if (includePointXY) {
      const geom = feature.geometry
      if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        const coords = geom.coordinates as number[]
        row.push(escapeCsvField(cellString(coords[0], false), delimiter))
        row.push(escapeCsvField(cellString(coords[1], false), delimiter))
      } else {
        row.push('', '')
      }
    }
    for (const field of propFields) {
      row.push(
        escapeCsvField(cellString(feature.properties?.[field], formulaGuard), delimiter)
      )
    }
    lines.push(row.join(delimiter))
  }

  return lines.join('\n')
}
