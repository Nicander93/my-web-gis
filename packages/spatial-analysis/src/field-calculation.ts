import jsep from 'jsep'
import { copyWithField, validateResultField } from './result-fields.js'
import type { AnalysisFeature } from './index.js'

export type FieldValue = string | number | boolean | null
export interface FieldCalculationOptions { field: string; expression: string }
export interface CompiledFieldExpression {
  readonly fields: readonly string[]
  evaluate(properties: Record<string, unknown>): FieldValue
}

const binaryOperators = new Set(['+', '-', '*', '/', '%', '**', '===', '!==', '<', '<=', '>', '>=', '&&', '||'])
const functions: Record<string, [number, number]> = { field: [1, 1], coalesce: [2, 16], abs: [1, 1], round: [1, 2], min: [1, 16], max: [1, 16], concat: [1, 16] }

/** Parse with jsep and evaluate only an explicit scalar AST subset; no eval, globals, members or arbitrary calls. */
export function compileFieldExpression(expression: string): CompiledFieldExpression {
  if (!expression.trim() || expression.length > 2048) throw new Error('表达式不能为空且最多 2048 个字符。')
  const tree = jsep(expression) as jsep.CoreExpression
  const fields = new Set<string>()
  let nodes = 0
  const validate = (node: jsep.CoreExpression, depth: number): void => {
    if (++nodes > 512 || depth > 40) throw new Error('表达式过于复杂。')
    const child = (value: jsep.Expression) => validate(value as jsep.CoreExpression, depth + 1)
    if (node.type === 'Literal') { scalar(node.value); return }
    if (node.type === 'UnaryExpression' && ['+', '-', '!'].includes(node.operator)) { child(node.argument); return }
    if (node.type === 'BinaryExpression' && binaryOperators.has(node.operator)) { child(node.left); child(node.right); return }
    if (node.type === 'ConditionalExpression') { child(node.test); child(node.consequent); child(node.alternate); return }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') {
      const name = (node.callee as jsep.Identifier).name
      if (!Object.hasOwn(functions, name)) throw new Error(`不支持函数 ${name}。`)
      const [min, max] = functions[name]
      if (node.arguments.length < min || node.arguments.length > max) throw new Error(`函数 ${name} 参数数量无效。`)
      if (name === 'field') {
        const argument = node.arguments[0] as jsep.Literal
        if (argument.type !== 'Literal' || typeof argument.value !== 'string' || !argument.value) throw new Error('field 必须使用非空的字段名文本。')
        fields.add(argument.value)
      }
      node.arguments.forEach(child)
      return
    }
    throw new Error('仅支持标量运算与列出的函数；不能访问对象、数组、全局变量或执行脚本。')
  }
  validate(tree, 0)
  return { fields: [...fields], evaluate: properties => evaluate(tree, properties) }
}

function scalar(value: unknown): FieldValue {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'boolean' || typeof value === 'string' && value.length <= 65536) return value as FieldValue
  throw new Error('字段或运算结果必须是有限数字、文本、布尔值或空值；文本最多 65536 个字符。')
}

function numeric(value: FieldValue): number {
  if (typeof value !== 'number') throw new Error('数值运算只接受数字，不自动转换文本或布尔值。')
  return value
}

function condition(value: FieldValue): boolean {
  if (value === null) return false
  if (typeof value !== 'boolean') throw new Error('条件必须是布尔值或空值。')
  return value
}

function evaluate(node: jsep.CoreExpression, properties: Record<string, unknown>): FieldValue {
  const child = (value: jsep.Expression) => evaluate(value as jsep.CoreExpression, properties)
  if (node.type === 'Literal') return scalar(node.value)
  if (node.type === 'ConditionalExpression') return child(condition(child(node.test)) ? node.consequent : node.alternate)
  if (node.type === 'UnaryExpression') {
    const value = child(node.argument)
    if (node.operator === '!') return !condition(value)
    return value === null ? null : scalar(node.operator === '-' ? -numeric(value) : numeric(value))
  }
  if (node.type === 'BinaryExpression') {
    const left = child(node.left)
    if (node.operator === '&&') return condition(left) ? condition(child(node.right)) : false
    if (node.operator === '||') return condition(left) ? true : condition(child(node.right))
    const right = child(node.right)
    if (node.operator === '===') return left === right
    if (node.operator === '!==') return left !== right
    if (left === null || right === null) return null
    const a = numeric(left), b = numeric(right)
    switch (node.operator) {
      case '+': return scalar(a + b)
      case '-': return scalar(a - b)
      case '*': return scalar(a * b)
      case '/': if (b === 0) throw new Error('除数不能为零。'); return scalar(a / b)
      case '%': if (b === 0) throw new Error('除数不能为零。'); return scalar(a % b)
      case '**': return scalar(a ** b)
      case '<': return a < b
      case '<=': return a <= b
      case '>': return a > b
      case '>=': return a >= b
    }
  }
  if (node.type === 'CallExpression') {
    const name = (node.callee as jsep.Identifier).name
    if (name === 'field') {
      const field = (node.arguments[0] as jsep.Literal).value as string
      return scalar(Object.hasOwn(properties, field) ? properties[field] : null)
    }
    if (name === 'coalesce') {
      for (const argument of node.arguments) { const value = child(argument); if (value !== null) return value }
      return null
    }
    const values = node.arguments.map(child)
    if (name === 'concat') return scalar(values.map(value => value === null ? '' : String(value)).join(''))
    if (values.includes(null)) return null
    const numbers = values.map(numeric)
    if (name === 'abs') return scalar(Math.abs(numbers[0]))
    if (name === 'min') return scalar(Math.min(...numbers))
    if (name === 'max') return scalar(Math.max(...numbers))
    if (name === 'round') {
      const digits = numbers[1] ?? 0
      if (!Number.isInteger(digits) || digits < 0 || digits > 12) throw new Error('round 小数位数必须为 0～12 的整数。')
      const factor = 10 ** digits
      return scalar(Math.round(numbers[0] * factor) / factor)
    }
  }
  throw new Error('表达式节点不支持。')
}

/** Compute a new scalar field in independent results; any row error fails the entire batch. */
export function calculateField<T extends AnalysisFeature>(features: readonly T[], options: FieldCalculationOptions): T[] {
  validateResultField(features, options.field)
  const compiled = compileFieldExpression(options.expression)
  for (const field of compiled.fields) {
    if (features.length && !features.some(feature => Object.hasOwn(feature.properties, field))) throw new Error(`输入字段 ${field} 不存在。`)
  }
  return features.map(feature => {
    try { return copyWithField(feature, options.field, compiled.evaluate(feature.properties)) }
    catch (error) { throw new Error(`要素 ${feature.id}：${error instanceof Error ? error.message : '字段计算失败'}`) }
  })
}
