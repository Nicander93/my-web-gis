import { expect, it } from 'vitest'
import { createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { createProject, parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/gis-core'
import { prepareProjectResourceReferences, resolveProjectResourceReferences } from './project-resource-references'
import { applyResourceRelocation, planResourceRelocation } from './resource-relocation'

function scene() {
  const value = createCesiumScene()
  value.assets.a = { type: 'glb', reference: { kind: 'relative', path: '模型/a.glb' } }
  value.assets.b = { type: '3dtiles', reference: { kind: 'absolute', path: 'D:/project/模型/tiles/tileset.json' } }
  value.assets.other = { type: 'glb', reference: { kind: 'absolute', path: 'D:/project/模型副本/a.glb' } }
  value.assets.remote = { type: 'glb', url: 'https://example.com/model.glb' }
  return value
}
it('relocates a directory with nested paths without affecting siblings or remote resources', () => {
  const original = scene()
  const changes = planResourceRelocation(original, 'a', 'E:/新模型', true, 'D:/project/main.json')
  expect(changes.map(change => change.assetId)).toEqual(['a', 'b'])
  const result = applyResourceRelocation(original, changes)
  expect(result.assets.a.reference).toEqual({ kind: 'absolute', path: 'E:/新模型/a.glb' })
  expect(result.assets.b.reference).toEqual({ kind: 'absolute', path: 'E:/新模型/tiles/tileset.json' })
  expect(result.assets.other).toEqual(original.assets.other)
  expect(original.assets.a.reference?.kind).toBe('relative')
})
it('replaces one file and rejects stale references atomically', () => {
  const original = scene()
  const changes = planResourceRelocation(original, 'a', 'E:/替换.glb', false, 'D:/project/main.json')
  expect(changes).toHaveLength(1)
  const updated = applyResourceRelocation(original, changes)
  expect(updated.assets.b).toEqual(original.assets.b)
  expect(() => applyResourceRelocation(updated, changes)).toThrow('已变化')
  expect(() => planResourceRelocation(original, 'a', '../escape', false, 'D:/project/main.json')).toThrow()
})

it('refuses directory relocation when a referenced object inherits a folder lock', () => {
  const original = scene()
  original.groups = [{ id: 'locked', name: 'Locked', locked: true, visible: true }]
  original.nodes.push({ id: 'tower', name: 'Tower', type: 'model', asset: 'b', visible: true, groupId: 'locked', position: [116, 39, 12], transform: createTransform() })
  const before = structuredClone(original)
  const changes = planResourceRelocation(original, 'a', 'E:/new', true, 'D:/project/main.json')
  expect(() => applyResourceRelocation(original, changes)).toThrow('已锁定')
  expect(original).toEqual(before)
})

it('preserves relocated resource identity through Save As and reopening', () => {
  const project = createProject()
  project.city = applyResourceRelocation(scene(), planResourceRelocation(scene(), 'a', 'E:/new', true, 'D:/project/main.json'))
  const working = { project, featuresByDataset: {} }
  const saved = prepareProjectResourceReferences(working, 'D:/project/main.json', 'E:/new/main.json')
  expect(saved.project.city!.assets.a.reference).toEqual({ kind: 'relative', path: 'a.glb' })
  expect(saved.project.city!.assets.b.reference).toEqual({ kind: 'relative', path: 'tiles/tileset.json' })
  const reopened = resolveProjectResourceReferences(parseProjectSnapshot(serializeProjectSnapshot(saved)), 'E:/new/main.json')
  expect(reopened).toEqual(working)
})
