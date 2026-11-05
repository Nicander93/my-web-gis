import { describe, expect, it } from 'vitest'
import { attributeRows, parseAttributeRows } from './graphic-attributes'

describe('graphic attribute editing', () => {
  it('round-trips primitive and structured JSON values without turning numbers/booleans into strings', () => {
    const properties = { name: '区域 A', area: 0, enabled: false, missing: null, tags: ['a','b'], metadata: { source: 'survey' } }
    expect(parseAttributeRows(attributeRows(properties))).toEqual(properties)
    const special = JSON.parse('{"__proto__":{"safe":true}}')
    const parsed = parseAttributeRows(attributeRows(special))
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true); expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
  })
  it('rejects duplicate/empty fields and malformed values before applying any change', () => {
    const rows = attributeRows({ height: 10 })
    expect(() => parseAttributeRows([...rows, { ...rows[0], id: 'b', name: ' height ' }])).toThrow('重复')
    expect(() => parseAttributeRows([{ ...rows[0], name: ' ' }])).toThrow('不能为空')
    for (const value of ['', 'Infinity', 'NaN']) expect(() => parseAttributeRows([{ ...rows[0], value }])).toThrow('数字')
    expect(() => parseAttributeRows([{ ...rows[0], type: 'boolean', value: 'yes' }])).toThrow('布尔')
    expect(() => parseAttributeRows([{ ...rows[0], type: 'json', value: '{' }])).toThrow('JSON')
    expect(parseAttributeRows([{ ...rows[0], type: 'string', value: '0' }])).toEqual({ height: '0' })
  })
})
