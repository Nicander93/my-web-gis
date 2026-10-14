import { expect, it } from 'vitest'
import { createCityScene, parseCityScene } from './index'
import { validateResourceReference } from './resource-reference'

it('distinguishes local paths from HTTP URLs without persisting runtime grants or credentials', () => {
  for (const reference of [{ kind: 'relative', path: '模型/ building.glb' }, { kind: 'absolute', path: 'D:/模型/building.glb' },
    { kind: 'absolute', path: '\\\\server\\share\\model.glb' }, { kind: 'url', url: 'https://example.test/model.glb', credentialRef: 'credential:model' }]) {
    expect(validateResourceReference(reference)).toBe(true)
  }
  for (const reference of [{ kind: 'relative', path: 'D:/model.glb' }, { kind: 'absolute', path: 'D:model.glb' },
    { kind: 'relative', path: '/model.glb' }, { kind: 'relative', path: 'file:///D:/model.glb' }, { kind: 'absolute', path: 'D:/model.glb:secret' },
    { kind: 'url', url: 'http://webgis-resource.localhost/token/model.glb' }, { kind: 'url', url: 'file:///D:/model.glb' },
    { kind: 'url', url: 'https://user:secret@example.test/model.glb' }, { kind: 'url', url: 'https://example.test/model.glb?token=secret' },
    { kind: 'relative', path: 'model.glb', url: 'https://different.test/model.glb' }]) expect(validateResourceReference(reference)).toBe(false)
})

it('keeps typed local references and existing URL scenes readable without changing asset identity', () => {
  const scene = createCityScene()
  scene.assets.local = { type: 'glb', reference: { kind: 'relative', path: 'models/model.glb' } }
  scene.assets.online = { type: '3dtiles', url: 'https://example.test/tileset.json' }
  expect(parseCityScene(JSON.stringify(scene)).assets).toEqual(scene.assets)
  scene.assets.local.reference = { kind: 'absolute', path: 'D:model.glb' }
  expect(() => parseCityScene(JSON.stringify(scene))).toThrow()
})
