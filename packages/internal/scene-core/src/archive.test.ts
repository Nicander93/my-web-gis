import { expect, it, vi } from 'vitest'
import { migrateSceneDocument } from '@desktop-webgis/scene-schema'
import { createSceneArchive, normalizeSceneArchivePath, readSceneArchive } from './archive.js'

const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))
function scene() {
  const document = migrateSceneDocument({ version: 2, id: 'scene', title: 'Scene', view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }, sources: {}, layers: [] })
  document.resources.city = { type: '3dtiles', url: './city/tileset.json' }
  return document
}
function glb(value: unknown): Uint8Array {
  const json = encode(value), padded = Math.ceil(json.length / 4) * 4, data = new Uint8Array(20 + padded)
  data.fill(32, 20)
  const view = new DataView(data.buffer)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, data.length, true)
  view.setUint32(12, padded, true); view.setUint32(16, 0x4e4f534a, true); data.set(json, 20)
  return data
}

it('collects nested tilesets, glTF buffers/textures and shared dependencies once', async () => {
  const document = scene(), before = structuredClone(document)
  const data: Record<string, Uint8Array> = {
    'city/tileset.json': encode({ asset: { version: '1.1' }, root: { content: { uri: 'nested/tileset.json' }, children: [{ content: { url: 'mesh.gltf' } }] } }),
    'city/nested/tileset.json': encode({ asset: { version: '1.1' }, root: { content: { uri: '../mesh.gltf' } } }),
    'city/mesh.gltf': encode({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin' }], images: [{ uri: '../textures/wall.png' }, { uri: 'data:image/png;base64,AA==' }] }),
    'city/mesh.bin': new Uint8Array([1, 2]), 'textures/wall.png': new Uint8Array([3, 4]),
  }
  const readFile = vi.fn(async (path: string) => { if (!data[path]) throw new Error('missing'); return data[path] })
  const entries = await createSceneArchive(document, { readFile })
  const restored = readSceneArchive(entries)
  expect(restored.document).toEqual(document)
  expect(restored.manifest.selfContained).toBe(true)
  expect(restored.manifest.included).toEqual(expect.arrayContaining(Object.keys(data)))
  expect(readFile).toHaveBeenCalledTimes(5)
  expect(document).toEqual(before)
  data['city/mesh.bin'][0] = 99
  expect(restored.files.get('city/mesh.bin')![0]).toBe(1)
})

it('reads GLB and B3DM embedded JSON dependencies without claiming remote content is bundled', async () => {
  const document = scene()
  const model = glb({ asset: { version: '2.0' }, images: [{ uri: 'https://textures.test/wall.png' }] })
  const tile = new Uint8Array(28 + model.length), view = new DataView(tile.buffer)
  tile.set(new TextEncoder().encode('b3dm')); view.setUint32(4, 1, true); view.setUint32(8, tile.length, true); tile.set(model, 28)
  const entries = await createSceneArchive(document, { readFile: async path => path.endsWith('.json') ? encode({ root: { content: { uri: 'mesh.b3dm' } } }) : tile })
  const result = readSceneArchive(entries)
  expect(result.manifest.selfContained).toBe(false)
  expect(result.manifest.external).toEqual([{ from: 'city/mesh.b3dm', url: 'https://textures.test/wall.png' }])
})

it('rejects missing dependencies, unsupported binary dependency formats and traversal', async () => {
  const document = scene()
  await expect(createSceneArchive(document, { readFile: async () => { throw new Error('not found') } })).rejects.toThrow('city/tileset.json')
  await expect(createSceneArchive(document, { readFile: async () => encode({ root: { content: { uri: '../../escape.glb' } } }) })).rejects.toThrow('escapes')
  await expect(createSceneArchive(document, { readFile: async path => path.endsWith('.json') ? encode({ root: { content: { uri: 'mesh.cmpt' } } }) : new Uint8Array() })).rejects.toThrow('dependencies: city/mesh.cmpt')
  for (const path of ['../escape', '/absolute', 'C:/model', 'a\\b', '%2e%2e/escape', 'a/%2Fescape']) expect(() => normalizeSceneArchivePath(path)).toThrow()
  expect(normalizeSceneArchivePath('../mesh.glb', 'city/nested/tileset.json')).toBe('city/mesh.glb')
})

it('validates duplicate entries, complete inventory, missing nested files and dishonest external manifests', async () => {
  const entries = await createSceneArchive(scene(), { readFile: async path => path.endsWith('.json') ? encode({ root: { content: { uri: 'mesh.glb' } } }) : glb({ asset: { version: '2.0' } }) })
  expect(() => readSceneArchive([...entries, { path: './scene.json', data: entries[0].data }])).toThrow('Duplicate')
  const omitted = entries.filter(entry => !entry.path.endsWith('.glb')).map(entry => ({ ...entry, data: entry.data.slice() }))
  const manifest = JSON.parse(new TextDecoder().decode(omitted.find(entry => entry.path === 'archive.json')!.data))
  manifest.included = manifest.included.filter((path: string) => !path.endsWith('.glb'))
  omitted.find(entry => entry.path === 'archive.json')!.data = encode(manifest)
  expect(() => readSceneArchive(omitted)).toThrow('Missing scene archive dependency')
  const dishonest = entries.map(entry => ({ ...entry, data: entry.data.slice() }))
  const original = JSON.parse(new TextDecoder().decode(dishonest.find(entry => entry.path === 'archive.json')!.data))
  original.external = [{ from: 'scene.json', url: 'https://invented.test/model' }]; original.selfContained = false
  dishonest.find(entry => entry.path === 'archive.json')!.data = encode(original)
  expect(() => readSceneArchive(dishonest)).toThrow('external references do not match')
})

it('enforces limits and cancellation without exposing a partial archive', async () => {
  const readFile = vi.fn(async () => new Uint8Array())
  await expect(createSceneArchive(scene(), { readFile, maxBytes: 1 })).rejects.toThrow('byte limit')
  expect(readFile).not.toHaveBeenCalled()
  const controller = new AbortController()
  await expect(createSceneArchive(scene(), { signal: controller.signal, readFile: async () => { controller.abort(); return new Uint8Array() } })).rejects.toMatchObject({ name: 'AbortError' })
  expect(() => readSceneArchive([{ path: 'scene.json', data: new Uint8Array(10) }], { maxBytes: 2 })).toThrow('byte limit')
  const pendingController = new AbortController()
  let complete!: (data: Uint8Array) => void
  const pending = createSceneArchive(scene(), { signal: pendingController.signal, readFile: () => new Promise(resolve => { complete = resolve }) })
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  pendingController.abort()
  await rejected
  complete(encode({ root: {} }))
})
