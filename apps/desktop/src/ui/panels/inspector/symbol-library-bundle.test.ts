import { describe, expect, it } from 'vitest'
import { BUILTIN_SYMBOL_PRESETS, type SymbolPreset } from '@desktop-webgis/ol-style/symbol-library'
import { readPersonalSymbolLibrary } from './symbol-library-store'
import { importSymbolPresetBundle, serializeSymbolPresetBundle } from './symbol-library-bundle'

function memoryStorage(): Storage & { writes: number } {
  const values = new Map<string, string>()
  return {
    writes: 0,
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key) },
    setItem(key, value) { this.writes += 1; values.set(key, value) }
  }
}

function presets(): SymbolPreset[] {
  return BUILTIN_SYMBOL_PRESETS.slice(0, 2).map((preset, index) => ({ ...structuredClone(preset), id: `bundle:${index}` }))
}

describe('personal symbol set bundles', () => {
  it('round-trips multiple presets and commits imported presets in one storage write', async () => {
    const storage = memoryStorage()
    const json = await serializeSymbolPresetBundle(presets())

    const imported = await importSymbolPresetBundle(json, storage, (() => {
      let index = 0
      return () => `personal:imported-${++index}`
    })())

    expect(storage.writes).toBe(1)
    expect(imported.presets.map(preset => preset.id)).toEqual(['personal:imported-1', 'personal:imported-2'])
    expect(readPersonalSymbolLibrary(storage)).toEqual(imported)
  })

  it('validates the full bundle before writing any of it', async () => {
    const storage = memoryStorage()
    const original = JSON.stringify({ version: 1, presets: [], favorites: [], recent: [], colorRamps: [] })
    storage.setItem('my-web-gis.symbol-library.v1', original)
    storage.writes = 0
    const [valid, malformed] = presets()
    const json = JSON.stringify({ format: 'my-web-gis.symbol-set', version: 1, presets: [valid, { ...malformed, name: '  ' }] })

    await expect(importSymbolPresetBundle(json, storage, () => 'personal:should-not-be-written')).rejects.toThrow()

    expect(storage.writes).toBe(0)
    expect(storage.getItem('my-web-gis.symbol-library.v1')).toBe(original)
    expect(readPersonalSymbolLibrary(storage).presets).toEqual([])
  })

  it('rejects duplicate source IDs and foreign bundle versions', async () => {
    const [first] = presets()
    const duplicateIds = JSON.stringify({ format: 'my-web-gis.symbol-set', version: 1, presets: [first, first] })
    const wrongVersion = JSON.stringify({ format: 'my-web-gis.symbol-set', version: 2, presets: [first] })
    await expect(importSymbolPresetBundle(duplicateIds, memoryStorage())).rejects.toThrow(/重复 ID/)
    await expect(importSymbolPresetBundle(wrongVersion, memoryStorage())).rejects.toThrow(/版本/)
  })
})
