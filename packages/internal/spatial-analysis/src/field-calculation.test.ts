import { expect, it } from 'vitest'
import { compileFieldExpression, calculateField, type AnalysisFeature } from './index'

const source: AnalysisFeature = { id: 'site', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { amount: 12.345, name: '站点', empty: null, zero: 0, nested: { value: 1 } } }

it('parses precedence, field references, rounding and scalar text functions', () => {
  expect(compileFieldExpression('1 + 2 * 3').evaluate({})).toBe(7)
  const compiled = compileFieldExpression('round(field("amount") / 2, 2)')
  expect(compiled.fields).toEqual(['amount'])
  expect(compiled.evaluate(source.properties)).toBe(6.17)
  expect(compileFieldExpression('concat(field("name"), "-", field("zero"))').evaluate(source.properties)).toBe('站点-0')
  expect(compileFieldExpression('max(abs(-10), min(2, 3))').evaluate({})).toBe(10)
  expect(compileFieldExpression('field("中文 字段") * 2').evaluate({ '中文 字段': 3 })).toBe(6)
})

it('propagates nulls and evaluates coalesce, conditions and booleans lazily', () => {
  expect(compileFieldExpression('field("empty") + 3').evaluate(source.properties)).toBeNull()
  expect(compileFieldExpression('coalesce(field("zero"), 1 / 0)').evaluate(source.properties)).toBe(0)
  expect(compileFieldExpression('field("amount") > 10 ? true : false').evaluate(source.properties)).toBe(true)
  expect(compileFieldExpression('false && (1 / 0 > 2)').evaluate({})).toBe(false)
  expect(compileFieldExpression('true || (1 / 0 > 2)').evaluate({})).toBe(true)
  expect(compileFieldExpression('null === null').evaluate({})).toBe(true)
  expect(compileFieldExpression('"1" === 1').evaluate({})).toBe(false)
})

it('rejects scripts and prototype/global access even in unused branches', () => {
  for (const expression of ['globalThis.process', 'field("name").constructor', 'constructor()', 'field("name")[0]', 'this', '[1, 2]', 'true ? 1 : fetch("/api")', 'x = 2', '1; 2', '1 << 2', 'field(field("name"))', 'toString()']) {
    expect(() => compileFieldExpression(expression), expression).toThrow()
  }
  expect(compileFieldExpression('field("toString")').evaluate({})).toBeNull()
})

it('rejects invalid arity, coercion, complex values, divide-by-zero and overflow', () => {
  for (const expression of ['field()', 'round(1, 2, 3)', 'coalesce(1)']) expect(() => compileFieldExpression(expression)).toThrow()
  for (const expression of ['"2" * 3', '1 / 0', '1 % 0', '10 ** 999', 'round(1, -1)', '1 ? 2 : 3', 'field("nested")']) expect(() => compileFieldExpression(expression).evaluate(source.properties)).toThrow()
  expect(() => compileFieldExpression('1'.repeat(2049))).toThrow('2048')
  expect(() => compileFieldExpression('-'.repeat(50) + '1')).toThrow('复杂')
})

it('calculates isolated results and fails the whole batch with feature context', () => {
  const before = structuredClone(source)
  const result = calculateField([source], { field: 'double', expression: 'field("amount") * 2' })[0]
  expect(result.properties.double).toBe(24.69)
  expect(result.metadata?.sourceId).toBe('site')
  expect(result.id).not.toBe(source.id)
  expect(source).toEqual(before)
  expect(() => calculateField([source], { field: 'amount', expression: '1' })).toThrow('已存在')
  expect(() => calculateField([source], { field: 'output', expression: 'field("missing")' })).toThrow('不存在')
  expect(() => calculateField([source, { ...source, id: 'bad', properties: { amount: '12' } }], { field: 'output', expression: 'field("amount") * 2' })).toThrow('要素 bad')
  const partial = calculateField([source, { ...source, id: 'missing', properties: {} }], { field: 'output', expression: 'field("amount")' })
  expect(partial[1].properties.output).toBeNull()
})
