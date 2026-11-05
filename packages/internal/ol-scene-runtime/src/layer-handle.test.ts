import { describe, expect, it, vi } from 'vitest'
import View from 'ol/View.js'
import VectorSource from 'ol/source/Vector.js'
import VectorLayer from 'ol/layer/Vector.js'
import { createOlLayerHandle } from './layer-handle.js'

describe('layer lifecycle handle', () => {
  const view = new View({ projection: 'EPSG:3857' })
  const definition = { type: 'vector' as const, id: 'points', name: 'Points', source: 'data', style: { mode: 'single' as const, symbol: { type: 'circle' as const, radius: 4, fill: { r: 255, g: 0, b: 0, a: 1 } } } }
  const sources = { data: { type: 'geojson' as const, data: { type: 'FeatureCollection' as const, features: [] } } }

  it('updates presentation in place and disposes only owned objects once', async () => {
    const handle = await createOlLayerHandle(definition, sources, view)
    const layer = handle.layer as VectorLayer, source = layer.getSource()!
    const disposeSource = vi.spyOn(source, 'dispose'), disposeLayer = vi.spyOn(layer, 'dispose')
    handle.update({ ...definition, visible: false, opacity: 0.25 })
    expect(layer.getSource()).toBe(source)
    expect(layer.getVisible()).toBe(false)
    expect(layer.getOpacity()).toBe(0.25)
    expect(() => handle.update({ ...definition, visible: true, opacity: NaN })).toThrow('opacity')
    expect(layer.getVisible()).toBe(false)
    expect(() => handle.update({ ...definition, source: 'other' })).toThrow('resource')
    handle.dispose(); handle.dispose()
    expect(disposeSource).toHaveBeenCalledTimes(1)
    expect(disposeLayer).toHaveBeenCalledTimes(1)
    expect(() => handle.update(definition)).toThrow('disposed')
  })

  it('retains externally supplied shared sources after both handles are disposed', async () => {
    const source = new VectorSource(), dispose = vi.spyOn(source, 'dispose')
    const first = await createOlLayerHandle(definition, sources, view, { vectorSource: source })
    const second = await createOlLayerHandle({ ...definition, id: 'other' }, sources, view, { vectorSource: source })
    expect((first.layer as VectorLayer).getSource()).toBe((second.layer as VectorLayer).getSource())
    first.dispose(); second.dispose()
    expect(dispose).not.toHaveBeenCalled()
    source.dispose()
  })

  it('rejects pre-cancelled creation without issuing a provider request', async () => {
    const controller = new AbortController(), fetcher = vi.fn()
    controller.abort()
    await expect(createOlLayerHandle(definition, sources, view, { signal: controller.signal, fetch: fetcher })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
