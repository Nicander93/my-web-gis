import { expect, it } from 'vitest'
import { zipSync } from 'fflate'
import { migrateSceneDocument } from '@desktop-webgis/scene-schema'
import { createSceneArchive } from './archive.js'
import { decodeSceneArchiveZip, encodeSceneArchiveZip } from './archive-zip.js'

it('round trips a real compressed scene ZIP and enforces compressed/expanded limits', async () => {
  const document = migrateSceneDocument({ version: 2, id: 'scene', title: 'Archive', view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }, sources: {}, layers: [] })
  const entries = await createSceneArchive(document, { readFile: async () => { throw new Error('unexpected read') } })
  const bytes = await encodeSceneArchiveZip(entries)
  expect([...bytes.subarray(0, 2)]).toEqual([80, 75])
  expect((await decodeSceneArchiveZip(bytes)).document).toEqual(document)
  await expect(decodeSceneArchiveZip(bytes, { maxCompressedBytes: 1 })).rejects.toThrow('compressed byte limit')
  await expect(decodeSceneArchiveZip(bytes, { maxBytes: 1, maxCompressedBytes: 100000 })).rejects.toThrow('expanded')
  await expect(encodeSceneArchiveZip(entries, { maxCompressedBytes: 1 })).rejects.toThrow('compressed byte limit')
})

it('rejects duplicate normalized names and traversal in ZIP entries before returning content', async () => {
  await expect(decodeSceneArchiveZip(zipSync({ 'scene.json': new Uint8Array(), './scene.json': new Uint8Array() }))).rejects.toThrow('Duplicate')
  await expect(decodeSceneArchiveZip(zipSync({ '../escape': new Uint8Array() }))).rejects.toThrow('escapes')
  const controller = new AbortController(); controller.abort()
  await expect(decodeSceneArchiveZip(new Uint8Array(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
})
