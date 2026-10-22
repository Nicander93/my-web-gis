import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStyleAsset } from './style-assets.js'
import { prepareCartographyResources } from './cartography-resources.js'
import type { ProjectStyleAsset } from './style-assets.js'

afterEach(() => vi.unstubAllGlobals())

function woff2Bytes(marker = 1): Uint8Array {
  const bytes = new Uint8Array(49), view = new DataView(bytes.buffer)
  view.setUint32(0, 0x774f4632); view.setUint32(4, 0x00010000); view.setUint32(8, bytes.length)
  view.setUint16(12, 1); view.setUint32(16, 1024); view.setUint32(20, 1); bytes[48] = marker
  return bytes
}

async function font(name: string, family: string, marker = 1): Promise<ProjectStyleAsset> {
  return createStyleAsset({ name, mimeType: 'font/woff2', bytes: woff2Bytes(marker), attribution: { source: 'Fixture', license: 'CC0-1.0' }, fontFamily: family })
}

function installFonts(failFamily?: string) {
  const registered = new Set<unknown>(), added: unknown[] = [], deleted: unknown[] = []
  const fonts = {
    add(face: unknown) { registered.add(face); added.push(face) },
    delete(face: unknown) { deleted.push(face); return registered.delete(face) }
  }
  const external = { family: 'External' }
  registered.add(external)
  class MockFontFace {
    constructor(readonly family: string, readonly source: string) {}
    async load() {
      if (this.family === failFamily) throw new Error('decode failed')
      return this as unknown as FontFace
    }
  }
  vi.stubGlobal('document', { fonts })
  vi.stubGlobal('FontFace', MockFontFace)
  return { registered, added, deleted, external }
}

describe('cartography resource ownership', () => {
  it('loads project fonts and dispose releases only its own font faces', async () => {
    const state = installFonts()
    const first = await font('Road Sans.woff2', 'Road Sans')
    const resources = await prepareCartographyResources([first])

    expect(state.added).toHaveLength(1)
    expect(state.registered.size).toBe(2)
    resources.dispose()
    resources.dispose()

    expect(state.deleted).toEqual(state.added)
    expect([...state.registered]).toEqual([state.external])
  })

  it('rolls back fonts loaded earlier when a later project font fails', async () => {
    const state = installFonts('Broken')
    const assets = [await font('Road Sans.woff2', 'Road Sans'), await font('Broken.woff2', 'Broken', 2)]

    await expect(prepareCartographyResources(assets)).rejects.toThrow('decode failed')
    expect(state.registered.size).toBe(1)
    expect(state.registered.has(state.external)).toBe(true)
    expect(state.deleted).toEqual(state.added)
  })

  it('rejects altered font bytes before registering a face', async () => {
    const state = installFonts()
    const asset = await font('Road Sans.woff2', 'Road Sans')
    const bytes = woff2Bytes()
    new DataView(bytes.buffer).setUint32(16, 2048)
    const binary = String.fromCharCode(...bytes)
    const tampered = { ...asset, dataUrl: `data:font/woff2;base64,${btoa(binary)}` }

    await expect(prepareCartographyResources([tampered])).rejects.toThrow('哈希')
    expect(state.added).toHaveLength(0)
  })
})
