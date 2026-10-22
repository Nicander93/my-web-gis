import { describe, expect, it } from 'vitest'
import { BUILTIN_SYMBOL_PRESETS } from '@desktop-webgis/ol-style/symbol-library'
import { createStyleAsset } from '@desktop-webgis/ol-style/style-assets'
import { readPersonalSymbolLibrary, validatePersonalSymbolLibrary, writePersonalSymbolLibrary } from './symbol-library-store.js'
import type { PersonalSymbolLibrary } from './symbol-library-store.js'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) }
  }
}

function validLibrary(): PersonalSymbolLibrary {
  return { version: 1, presets: [], favorites: [], recent: [], colorRamps: [] }
}

describe('personal symbol library persistence', () => {
  it('round-trips a validated personal preset and typed color ramp', async () => {
    const storage = memoryStorage()
    const preset = structuredClone(BUILTIN_SYMBOL_PRESETS[0]!)
    preset.id = 'personal:roads'
    const value: PersonalSymbolLibrary = {
      ...validLibrary(), presets: [preset], favorites: [preset.id], recent: [preset.id],
      colorRamps: [{ id: 'ramp-1', name: 'Heat', colors: ['#000000', '#ffffff'] }]
    }

    expect(validatePersonalSymbolLibrary(value)).toEqual([])
    await writePersonalSymbolLibrary(value, storage)
    expect(readPersonalSymbolLibrary(storage)).toEqual(value)
  })

  it('rejects invalid preset names, category, and embedded assets before saving', () => {
    const preset = structuredClone(BUILTIN_SYMBOL_PRESETS[0]!)
    preset.id = 'personal:bad'
    preset.name = '   '
    expect(validatePersonalSymbolLibrary({ ...validLibrary(), presets: [preset] })).not.toEqual([])

    const invalid = structuredClone(BUILTIN_SYMBOL_PRESETS[0]!)
    invalid.id = 'personal:bad-category'
    ;(invalid as { category: string }).category = 'unknown'
    expect(validatePersonalSymbolLibrary({ ...validLibrary(), presets: [invalid] })).not.toEqual([])

    const invalidAsset = structuredClone(BUILTIN_SYMBOL_PRESETS[0]!)
    invalidAsset.id = 'personal:bad-asset'
    invalidAsset.assets = [{ id: 'asset-deadbeef', name: 'bad.woff2', mimeType: 'font/woff2', dataUrl: 'data:font/woff2;base64,AA==', contentHash: 'deadbeef', fontFamily: 'Bad', attribution: { source: 'Fixture', license: 'CC0-1.0' } }]
    expect(validatePersonalSymbolLibrary({ ...validLibrary(), presets: [invalidAsset] })).not.toEqual([])
  })

  it('never overwrites malformed original localStorage data while reporting the error', async () => {
    const storage = memoryStorage()
    storage.setItem('my-web-gis.symbol-library.v1', '{broken json')
    const original = storage.getItem('my-web-gis.symbol-library.v1')

    expect(() => readPersonalSymbolLibrary(storage)).toThrow('原始数据已保留')
    await expect(writePersonalSymbolLibrary(validLibrary(), storage)).rejects.toThrow('JSON 无效')
    expect(storage.getItem('my-web-gis.symbol-library.v1')).toBe(original)
  })

  it('does not hide browser storage quota or access failures', async () => {
    const storage = memoryStorage()
    storage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    await expect(writePersonalSymbolLibrary(validLibrary(), storage)).rejects.toThrow('quota')
  })

  it('verifies asset content hashes before persisting a personal preset', async () => {
    const storage = memoryStorage()
    const preset = structuredClone(BUILTIN_SYMBOL_PRESETS[0]!)
    preset.id = 'personal:tampered-asset'
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><!--one--></svg>'
    const asset = await createStyleAsset({ name: 'mark.svg', mimeType: 'image/svg+xml', bytes: new TextEncoder().encode(source), attribution: { source: 'Fixture', license: 'CC0-1.0' } })
    const altered = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><!--two--></svg>'
    preset.assets = [{ ...asset, dataUrl: `data:image/svg+xml;base64,${btoa(altered)}` }]

    await expect(writePersonalSymbolLibrary({ ...validLibrary(), presets: [preset] }, storage)).rejects.toThrow('哈希')
    expect(storage.getItem('my-web-gis.symbol-library.v1')).toBeNull()
  })

  it('does not overwrite data changed by another window while hashes are checked', async () => {
    const validRaw = JSON.stringify(validLibrary())
    const brokenRaw = '{changed by another window'
    let readCount = 0, written = false
    const storage = {
      get length() { return 1 },
      clear() {},
      getItem() { return ++readCount === 1 ? validRaw : brokenRaw },
      key() { return 'my-web-gis.symbol-library.v1' },
      removeItem() {},
      setItem() { written = true }
    } as unknown as Storage

    await expect(writePersonalSymbolLibrary(validLibrary(), storage)).rejects.toThrow('JSON 无效')
    expect(written).toBe(false)
  })
})
