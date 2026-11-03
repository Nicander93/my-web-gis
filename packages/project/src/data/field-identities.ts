import { createId } from '../id'

/** Absent entries stay unchanged; an explicit undefined retires that historical column. */
export type FieldNameMap = ReadonlyMap<string, string | undefined>

/** Runtime-only column identities; field names can change without changing the logical column. */
export function createFieldIdentities(names: Iterable<string>, previous?: ReadonlyMap<string, string>): Map<string, string> {
  const result = new Map<string, string>()
  for (const name of names) if (!result.has(name)) result.set(name, previous?.get(name) ?? createId('column'))
  if ([...result.values()].some(id => typeof id !== 'string' || !id) || new Set(result.values()).size !== result.size) throw new Error('Invalid field identities')
  return result
}
export function sameFieldIdentities(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  return left.size === right.size && [...left].every(([name, id]) => right.get(name) === id)
}

/** Matches logical columns first; a reused name must not revive a retired column. */
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
