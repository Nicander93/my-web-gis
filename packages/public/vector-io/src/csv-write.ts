/**
 * 按 RFC4180 转义导出属性 CSV，可以选择开启表格公式防护。
 *
 * 公式防护默认开启：字符串形式以 = + - @ 制表符或回车开头的值
 * 会在前面加一个单引号，让常见的表格软件把它们当作文本。
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
  /** 列分隔符，默认是 `,`。 */
  delimiter?: string
  /**
   * 给看起来像表格公式的值加上 `'` 前缀。
   * 默认 `true`，在导出对话框的帮助文字里有说明。
   */
  formulaGuard?: boolean
  /** 把要素的 `id` 作为第一列输出，默认 `true`。 */
  includeId?: boolean
  /** 为点要素额外输出几何列 `x` 和 `y`，默认 `false`。 */
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

/** 收集所有要素属性键的并集，保证稳定并排好序。 */
export function collectCsvFields(features: CsvExportFeature[]): string[] {
  const keys = new Set<string>()
  for (const feature of features) {
    for (const key of Object.keys(feature.properties ?? {})) keys.add(key)
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b))
}

/**
 * 把要素序列化成属性 CSV 字符串。
 * 要素列表为空时返回 `null`，让调用方可以拒绝写出一个会误导人的文件。
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
