import { createId } from '../id'

/** 没有出现的条目保持不变；显式写 undefined 表示废弃那个历史列。 */
export type FieldNameMap = ReadonlyMap<string, string | undefined>

/** 只在运行时存在的列身份；字段名变化不等于逻辑列变化。 */
export function createFieldIdentities(names: Iterable<string>, previous?: ReadonlyMap<string, string>): Map<string, string> {
  const result = new Map<string, string>()
  for (const name of names) if (!result.has(name)) result.set(name, previous?.get(name) ?? createId('column'))
  if ([...result.values()].some(id => typeof id !== 'string' || !id) || new Set(result.values()).size !== result.size) throw new Error('Invalid field identities')
  return result
}
export function sameFieldIdentities(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  return left.size === right.size && [...left].every(([name, id]) => right.get(name) === id)
}

/** 优先匹配逻辑列；复用了旧名字也不应该让已废弃的列重新生效。 */
export function getFieldNameChanges(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): FieldNameMap {
  const namesByIdentity = new Map([...after].map(([name, identity]) => [identity, name]))
  return new Map([...before].flatMap(([name, identity]) => {
    const currentName = namesByIdentity.get(identity)
    return currentName === name ? [] : [[name, currentName] as const]
  }))
}
export interface SchemaIdentityEdit {
  key: object
  forward: boolean
  datasetIds?: readonly string[]
  before?: string
  after?: string
}
