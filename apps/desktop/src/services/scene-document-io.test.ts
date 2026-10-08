import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSceneDocument, serializeSceneDocument } from '@desktop-webgis/scene-core'
import { getCurrentProjectPath, setCurrentProjectPath } from './project-io'
import { openSceneDocument, saveSceneDocument } from './scene-document-io'

const probe = vi.hoisted(() => ({ native: false, pick: vi.fn(), download: vi.fn(), nativePick: vi.fn(), savePick: vi.fn(), read: vi.fn(), write: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => probe.native }))
vi.mock('./browser-project-files', () => ({ pickBrowserProject: probe.pick, downloadProject: probe.download }))
vi.mock('./files', () => ({ pickFile: probe.nativePick, pickSaveFile: probe.savePick, readTextFile: probe.read, writeTextFile: probe.write }))
vi.mock('@/features/map/map-runtime-host', () => ({ getLiveMapState: () => null }))
function document() { return createSceneDocument({ id: 'scene', title: 'Scene', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } }) }
beforeEach(() => { vi.clearAllMocks(); probe.native = false; setCurrentProjectPath('original.webgis.json') })

describe('full scene JSON IO', () => {
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
  it('uses native dialogs and file writer, with cancellation leaving files untouched', async () => {
    probe.native = true; probe.savePick.mockResolvedValue(null)
    expect(await saveSceneDocument(document(), 'City')).toEqual({ kind: 'cancelled' })
    expect(probe.write).not.toHaveBeenCalled()
    probe.savePick.mockResolvedValue('D:/City.scene.json')
    expect(await saveSceneDocument(document(), 'City')).toEqual({ kind: 'saved', path: 'D:/City.scene.json' })
    expect(probe.write).toHaveBeenCalledWith('D:/City.scene.json', serializeSceneDocument(document()))
    expect(getCurrentProjectPath()).toBe('original.webgis.json')
  })
})
