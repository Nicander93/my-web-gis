import { expect, it } from 'vitest'
import { createSceneDocument } from './document.js'
import { mergeSceneDocuments } from './merge.js'

function scene() {
  const document = createSceneDocument({ id: 'scene', title: 'Scene', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } })
  document.credentials = { account: { type: 'runtime-reference', key: 'account-key' } }
  document.resources.base = { type: 'provider', provider: 'tianditu', mapType: 'imagery', credential: 'account' }
  document.nodes = [{ type: 'group', id: 'group', name: 'Group', visible: true }, { type: 'tile', id: 'base', name: 'Base', parentId: 'group', resource: 'base' }]
  return document
}

it('merges complete contents with collision reports and repairs resources, parents and credentials', () => {
  const target = scene(), incoming = scene()
  incoming.resources['base-2'] = { type: 'xyz', url: 'https://example.test/{z}/{x}/{y}.png' }
  const before = JSON.stringify([target, incoming])
  const { document, ids } = mergeSceneDocuments(target, incoming)
  expect(ids.resources).toEqual({ base: 'base-3', 'base-2': 'base-2' })
  expect(document.nodes[3]).toMatchObject({ id: 'base-2', parentId: 'group-2', resource: 'base-3' })
  expect(document.resources['base-3']).toMatchObject({ credential: 'account-2' })
  expect(document.credentials?.['account-2']).toEqual(incoming.credentials?.account)
  expect(document.views['map-2']).toEqual(incoming.views.map)
  expect(document.activeView).toBe('map')
  expect(JSON.stringify([target, incoming])).toBe(before)
})

it('rejects incompatible settings or opaque extension references without changing either input', () => {
  const target = scene(), incoming = scene()
  target.environment = { effects: { fog: 0, bloom: false } }
  incoming.environment = { effects: { fog: 0.2, bloom: false } }
  const before = JSON.stringify([target, incoming])
  expect(() => mergeSceneDocuments(target, incoming)).toThrow('environment.effects')
  expect(JSON.stringify([target, incoming])).toBe(before)
  incoming.environment = target.environment
  incoming.extensions = { 'example.references': { version: 1, required: false, data: { node: 'base' } } }
  expect(() => mergeSceneDocuments(target, incoming)).toThrow('merge adapter')
})

it('retains prototype-shaped resource keys as own JSON properties', () => {
  const target = scene(), incoming = scene()
  incoming.resources = JSON.parse('{"__proto__":{"type":"xyz","url":"https://example.test/{z}/{x}/{y}.png"}}')
  incoming.nodes = [{ type: 'tile', id: 'proto', name: 'Proto', resource: '__proto__' }]
  const result = mergeSceneDocuments(target, incoming)
  expect(Object.hasOwn(result.document.resources, '__proto__')).toBe(true)
  expect(result.document.nodes.at(-1)).toMatchObject({ resource: '__proto__' })
})
