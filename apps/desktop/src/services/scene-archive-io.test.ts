import { expect, it, vi, beforeEach } from 'vitest'
import { migrateSceneDocument } from '@desktop-webgis/scene-schema'
import { decodeSceneArchiveZip } from '@desktop-webgis/scene-core'
import { saveSceneArchive } from './scene-archive-io'

const probe = vi.hoisted(() => ({ directory: vi.fn(), save: vi.fn(), read: vi.fn(), write: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('./files', () => ({ pickDirectory: probe.directory, pickSaveFile: probe.save, readSceneResourceFile: probe.read, writeBinaryFile: probe.write }))
beforeEach(() => { vi.clearAllMocks(); probe.directory.mockResolvedValue('C:/scene'); probe.save.mockResolvedValue('C:/exports/test.scene.zip'); probe.write.mockResolvedValue(undefined) })
function scene() {
  return migrateSceneDocument({ version: 2, id: 'scene', title: 'Scene', view: { projection: 'EPSG:3857', center: [0, 0], zoom: 2 }, sources: {}, layers: [] })
}

it('exports a real ZIP through the native save adapter without changing project URLs', async () => {
  const document = scene()
  document.resources.model = { type: 'glb', url: './models/model.gltf' }
  const before = structuredClone(document)
  probe.read.mockImplementation(async (_directory: string, path: string) => path.endsWith('.gltf') ? new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin' }] })) : new Uint8Array([1, 2, 3]))
  const result = await saveSceneArchive(document, 'Test')
  expect(result).toEqual({ kind: 'saved', path: 'C:/exports/test.scene.zip' })
  const bytes = probe.write.mock.calls[0][1] as Uint8Array
  const restored = await decodeSceneArchiveZip(bytes)
  expect(restored.files.get('models/mesh.bin')).toEqual(new Uint8Array([1, 2, 3]))
  expect(probe.read).toHaveBeenCalledWith('C:/scene', 'models/model.gltf')
  expect(document).toEqual(before)
})

it('does not read or write after directory cancellation or a missing resource', async () => {
  const document = scene(); document.resources.model = { type: 'glb', url: './models/model.glb' }
  probe.directory.mockResolvedValueOnce(null)
  expect(await saveSceneArchive(document, 'Test')).toEqual({ kind: 'cancelled' })
  expect(probe.read).not.toHaveBeenCalled(); expect(probe.write).not.toHaveBeenCalled()
  probe.read.mockRejectedValue(new Error('missing'))
  await expect(saveSceneArchive(document, 'Test')).rejects.toThrow('models/model.glb')
  expect(probe.save).not.toHaveBeenCalled(); expect(probe.write).not.toHaveBeenCalled()
})

it('keeps remote references external without asking for a resource directory', async () => {
  const document = scene(); document.resources.model = { type: 'glb', url: 'https://example.test/model.glb' }
  await saveSceneArchive(document, 'Test')
  expect(probe.directory).not.toHaveBeenCalled(); expect(probe.read).not.toHaveBeenCalled()
  const archive = await decodeSceneArchiveZip(probe.write.mock.calls[0][1])
  expect(archive.manifest.selfContained).toBe(false)
  expect(archive.manifest.external).toEqual([{ from: 'scene.json', url: 'https://example.test/model.glb' }])
})
