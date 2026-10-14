export type AttributeType = 'string' | 'number' | 'boolean' | 'null' | 'json'
export interface AttributeRow { id: string; name: string; type: AttributeType; value: string }

export function attributeRows(properties: Record<string, unknown>): AttributeRow[] {
  return Object.entries(properties).map(([name, value], index) => ({ id: String(index), name,
    type: value === null ? 'null' : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? typeof value as AttributeType : 'json',
    value: typeof value === 'string' ? value : JSON.stringify(value) }))
}

/** Parse atomically: duplicate fields and malformed values never partially apply. */
export function parseAttributeRows(rows: AttributeRow[]): Record<string, unknown> {
  const names = new Set<string>()
  return Object.fromEntries(rows.map(row => {
    const name = row.name.trim()
    if (!name) throw new Error('字段名不能为空')
    if (names.has(name)) throw new Error(`字段「${name}」重复`)
    names.add(name)
    let value: unknown = row.value
    if (row.type === 'number') {
      value = Number(row.value)
      if (!row.value.trim() || !Number.isFinite(value)) throw new Error(`字段「${name}」需要有效数字`)
    } else if (row.type === 'boolean') {
      if (!['true', 'false'].includes(row.value)) throw new Error(`字段「${name}」需要布尔值`)
      value = row.value === 'true'
    } else if (row.type === 'null') value = null
    else if (row.type === 'json') {
      try { value = JSON.parse(row.value) } catch { throw new Error(`字段「${name}」的 JSON 无效`) }
    }
    return [name, value]
  }))
}
