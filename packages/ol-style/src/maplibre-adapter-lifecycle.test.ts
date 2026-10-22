import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyStyle } from 'ol-mapbox-style'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Style from 'ol/style/Style.js'
import type { StyleSpecification } from '@maplibre/maplibre-gl-style-spec'
import { createMapLibreCanvasBinding } from './maplibre-adapter.js'

// Only control the external resource boundary; use real OL layers and validation.
vi.mock('ol-mapbox-style', () => ({ applyStyle: vi.fn() }))

function createStyle(name: string): StyleSpecification {
  return {
    version: 8, name,
    sources: { roads: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers: [{ id: 'road', type: 'line', source: 'roads' }],
  }
}

describe('MapLibre resource update lifecycle', () => {
  beforeEach(() => { vi.mocked(applyStyle).mockReset() })

  it('serializes active resource loads and coalesces pending inputs to the latest update', async () => {
    const layer = new VectorLayer({ source: new VectorSource() })
    const binding = createMapLibreCanvasBinding(layer, { sourceId: 'roads' })
    const completions: (() => void)[] = []
    vi.mocked(applyStyle).mockImplementation((target, document) => new Promise<void>(resolve => {
      completions.push(() => {
        target.setStyle(new Style())
        target.set('test-style-name', document.name)
        resolve()
      })
    }))
    const first = binding.update(createStyle('first'))
    await Promise.resolve()
    expect(completions).toHaveLength(1)
    const skipped = binding.update(createStyle('skipped'))
    const latest = binding.update(createStyle('latest'))
    expect(completions).toHaveLength(1)
    completions[0]()
    await expect(first).resolves.toBe(false)
    await expect(skipped).resolves.toBe(false)
    expect(completions).toHaveLength(2)
    completions[1]()
    await expect(latest).resolves.toBe(true)
    expect(layer.get('test-style-name')).toBe('latest')
    expect(vi.mocked(applyStyle).mock.calls.map(([, document]) => document.name)).toEqual(['first', 'latest'])
  })

  it('can apply a new update after a resource request fails', async () => {
    const layer = new VectorLayer({ source: new VectorSource() })
    const binding = createMapLibreCanvasBinding(layer, { sourceId: 'roads' })
    vi.mocked(applyStyle).mockRejectedValueOnce(new Error('sprite unavailable')).mockResolvedValueOnce(undefined)
    await expect(binding.update(createStyle('broken'))).rejects.toThrow('sprite unavailable')
    await expect(binding.update(createStyle('recovered'))).resolves.toBe(true)
  })
})
