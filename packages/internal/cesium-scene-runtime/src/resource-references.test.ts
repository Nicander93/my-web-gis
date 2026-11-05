import { expect, it } from 'vitest'
import { createCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { resolveSceneResourceReferences } from './resource-references'

it('resolves only a detached rendering copy and stops aborted reference preparation', async () => {
  const scene = createCesiumScene()
  scene.assets.model = { type: 'glb', reference: { kind: 'relative', path: 'model.glb' } }
  const url = 'http://webgis-resource.localhost/key/model.glb'
  expect((await resolveSceneResourceReferences(scene, async () => url)).assets.model.url).toBe(url)
  expect(scene.assets.model).not.toHaveProperty('url')
  await expect(resolveSceneResourceReferences(scene)).rejects.toThrow('宿主')
  const operation = new AbortController()
  await expect(resolveSceneResourceReferences(scene, async () => { operation.abort(); return url }, operation.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(scene.assets.model.reference).toEqual({ kind: 'relative', path: 'model.glb' })
})
