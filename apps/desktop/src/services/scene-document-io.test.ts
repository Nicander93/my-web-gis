import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSceneDocument, createSceneArchive, encodeSceneArchiveZip, serializeSceneDocument } from '@desktop-webgis/scene-core'
import { createProjectFromSceneDocument, createProjectSceneDocument } from '@/features/scene/project-scene-document'
import { parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/gis-core'
import { getCurrentProjectPath, setCurrentProjectPath } from './project-io'
import { openSceneArchiveBytes, openSceneDocument, saveSceneDocument } from './scene-document-io'

const probe = vi.hoisted(() => ({ native: false, pick: vi.fn(), download: vi.fn(), nativePick: vi.fn(), savePick: vi.fn(), read: vi.fn(), write: vi.fn(), persist: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => probe.native, invoke: probe.persist, convertFileSrc: () => 'http://asset.localhost/cache/scene.json' }))
vi.mock('./browser-project-files', () => ({ pickBrowserProject: probe.pick, downloadProject: probe.download }))
vi.mock('./files', () => ({ pickFile: probe.nativePick, pickSaveFile: probe.savePick, readTextFile: probe.read, writeTextFile: probe.write }))
vi.mock('@/features/map/map-runtime-host', () => ({ getLiveMapState: () => null }))
function document() { return createSceneDocument({ id: 'scene', title: 'Scene', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } }) }
beforeEach(() => { vi.clearAllMocks(); probe.native = false; setCurrentProjectPath('original.webgis.json') })

describe('full scene JSON IO', () => {
  it('imports package vector files without native extraction and keeps the save destination', async () => {
    const input = document()
    input.resources.points = { type: 'geojson', url: './data/points.geojson' }
    input.nodes = [{ type: 'vector', id: 'points', name: 'Points', resource: 'points', style: { mode: 'single', symbol: { type: 'circle', radius: 4 } } }]
    const entries = await createSceneArchive(input, { readFile: async () => new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features: [] })) })
    const opened = await openSceneArchiveBytes(await encodeSceneArchiveZip(entries), 'points.scene.zip')
    expect(opened.document.resources.points).toMatchObject({ data: { type: 'FeatureCollection', features: [] } })
    expect(probe.persist).not.toHaveBeenCalled()
    expect(getCurrentProjectPath()).toBe('original.webgis.json')
  })

  it('persists native model dependencies and retains their usable base after project reopen', async () => {
    const input = document(); input.resources.model = { type: 'glb', url: './models/mesh.gltf' }
    const entries = await createSceneArchive(input, { readFile: async path => path.endsWith('.gltf') ? new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: '../texture.png' }] })) : new Uint8Array([1, 2]) })
    const bytes = await encodeSceneArchiveZip(entries)
    await expect(openSceneArchiveBytes(bytes, 'city.scene.zip')).rejects.toThrow('桌面端')
    expect(probe.persist).not.toHaveBeenCalled()
    probe.native = true; probe.persist.mockResolvedValue('C:/cache')
    const opened = await openSceneArchiveBytes(bytes, 'city.scene.zip')
    expect(probe.persist.mock.calls[0][1].files).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'texture.png', content: [1, 2] })]))
    expect(opened.document.resources.model).toMatchObject({ url: 'http://asset.localhost/cache/models/mesh.gltf' })
    const reopened = parseProjectSnapshot(serializeProjectSnapshot(createProjectFromSceneDocument(opened.document)))
    expect(createProjectSceneDocument(reopened).resources.model).toMatchObject({ url: 'http://asset.localhost/cache/models/mesh.gltf' })
    expect(getCurrentProjectPath()).toBe('original.webgis.json')
  })
  it('downloads complete JSON without changing project save destination', async () => {
    const input = document()
    expect(await saveSceneDocument(input, 'City')).toEqual({ kind: 'download-started', name: 'City.scene.json' })
    expect(probe.download).toHaveBeenCalledWith(serializeSceneDocument(input), 'City.scene.json')
    expect(getCurrentProjectPath()).toBe('original.webgis.json')
  })
  it('reads browser scenes, returns cancellation and rejects invalid JSON', async () => {
    probe.pick.mockResolvedValue({ name: 'scene.json', text: async () => serializeSceneDocument(document()) })
    expect(await openSceneDocument()).toEqual({ path: 'scene.json', document: document() })
    probe.pick.mockResolvedValue(null); expect(await openSceneDocument()).toBeNull()
    probe.pick.mockResolvedValue({ name: 'bad.json', text: async () => '{' })
    await expect(openSceneDocument()).rejects.toThrow()
    expect(getCurrentProjectPath()).toBe('original.webgis.json')
  })
  it('rejects a cancelled import even when the file picker returns late', async () => {
    const controller = new AbortController()
    probe.pick.mockImplementation(async () => {
      controller.abort()
      return { name: 'scene.json', text: async () => serializeSceneDocument(document()) }
    })
    await expect(openSceneDocument(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(getCurrentProjectPath()).toBe('original.webgis.json')
  })
  it('uses native dialogs and file writer, with cancellation leaving files untouched', async () => {
    probe.native = true; probe.savePick.mockResolvedValue(null)
    expect(await saveSceneDocument(document(), 'City')).toEqual({ kind: 'cancelled' })
    expect(probe.write).not.toHaveBeenCalled()
    probe.savePick.mockResolvedValue('D:/City.scene.json')
    expect(await saveSceneDocument(document(), 'City')).toEqual({ kind: 'saved', path: 'D:/City.scene.json' })
    expect(probe.write).toHaveBeenCalledWith('D:/City.scene.json', serializeSceneDocument(document()))
    expect(getCurrentProjectPath()).toBe('original.webgis.json')
  })
  it('prepares relative native vector data before returning a scene and refuses browser path guessing', async () => {
    const input = document()
    input.resources.points = { type: 'geojson', url: './data/points.geojson' }
    input.nodes = [{ type: 'vector', id: 'points', name: 'Points', resource: 'points', style: { mode: 'single', symbol: { type: 'circle', radius: 4 } } }]
    const data = { type: 'FeatureCollection', features: [] }
    probe.native = true
    probe.nativePick.mockResolvedValue('D:/scenes/project.scene.json')
    probe.read.mockImplementation(async (path: string) => path.endsWith('project.scene.json') ? serializeSceneDocument(input) : JSON.stringify(data))
    const opened = await openSceneDocument()
    expect(opened?.document.resources.points).toMatchObject({ data })
    expect(probe.read).toHaveBeenCalledWith('D:/scenes/data/points.geojson')
    probe.native = false
    probe.pick.mockResolvedValue({ name: 'project.scene.json', text: async () => serializeSceneDocument(input) })
    await expect(openSceneDocument()).rejects.toThrow('相对资源')
    expect(getCurrentProjectPath()).toBe('original.webgis.json')
  })
})
