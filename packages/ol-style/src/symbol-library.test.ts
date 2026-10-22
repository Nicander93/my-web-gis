import { describe, expect, it } from 'vitest'
import { BUILTIN_SYMBOL_PRESETS, instantiateSymbolPreset, parseSymbolPreset, validateSymbolPreset } from './symbol-library.js'

describe('standard symbol presets', () => {
  it('validates every shipped professional example with the standard v8 validator', () => {
    for (const preset of BUILTIN_SYMBOL_PRESETS) expect(validateSymbolPreset(preset), preset.id).toEqual([])
  })
  it('copies definitions with new stable identities and no library coupling', async () => {
    const preset = await parseSymbolPreset(JSON.stringify(BUILTIN_SYMBOL_PRESETS[0]))
    let index = 0
    const layers = instantiateSymbolPreset(preset, 'roads', () => `road-${++index}`)
    expect(layers.map(layer => layer.id)).toEqual(['road-1', 'road-2'])
    expect(layers[0]).toMatchObject({ source: 'roads', paint: { 'line-width': 8 } })
    layers[0].metadata = { changed: true }
    expect(preset.layers[0].metadata).toBeUndefined()
    await expect(parseSymbolPreset(JSON.stringify({ ...preset, layers: [{ ...preset.layers[0], paint: { 'line-width': ['bad-expression'] } }] }))).rejects.toThrow()
  })
})
