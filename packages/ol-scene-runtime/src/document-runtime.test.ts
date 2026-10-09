import { describe, expect, it, vi } from 'vitest'
import Collection from 'ol/Collection.js'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import type BaseLayer from 'ol/layer/Base.js'
import type { SceneDocument } from '@desktop-webgis/scene-schema'

vi.mock('ol/Map.js', () => ({ default: class {
  layers = new Collection<BaseLayer>()
  view: View
  constructor(options: { view: View }) { this.view = options.view }
  getLayers() { return this.layers }
  getView() { return this.view }
  setView(view: View) { this.view = view }
  addLayer(layer: BaseLayer) { this.layers.push(layer) }
  removeLayer(layer: BaseLayer) { this.layers.remove(layer) }
  setTarget() {}
  dispose() {}
} }))

import { OlDocumentRuntime } from './document-runtime.js'

function document(id: string, remote = false): SceneDocument {
  return { version: 3, id, title: id, activeView: 'map', views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } },
    resources: { data: remote ? { type: 'geojson', url: './points.geojson' } : { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    nodes: [{ type: 'vector', id, name: id, resource: 'data', visible: true, style: { mode: 'single', symbol: { type: 'circle', radius: 4, fill: { r: 255, g: 0, b: 0, a: 1 } } } }] }
}

describe('v3 document runtime lifecycle', () => {
  it('retains host layers and restores its view without disposing the external map', async () => {
    const view = new View(), map = new Map({ view }), host = new TileLayer()
    map.addLayer(host)
    const dispose = vi.spyOn(map, 'dispose'), runtime = new OlDocumentRuntime({ map })
    await runtime.loadDocument(document('first'))
    await runtime.loadDocument(document('second'))
    expect(map.getLayers().getArray()).toEqual([host, runtime.getLayer('second')])
    runtime.destroy(); runtime.destroy()
    expect(map.getLayers().getArray()).toEqual([host])
    expect(map.getView()).toBe(view)
    expect(dispose).not.toHaveBeenCalled()
  })

  it('keeps previous document, native layer and view when preparation fails', async () => {
    const map = new Map({ view: new View() })
    const runtime = new OlDocumentRuntime({ map, fetch: vi.fn(async () => new Response('', { status: 503 })) })
    await runtime.loadDocument(document('first'))
    const layer = runtime.getLayer('first'), view = map.getView()
    await expect(runtime.loadDocument(document('failed', true))).rejects.toThrow('503')
    expect(runtime.getDocument()?.id).toBe('first')
    expect(runtime.getLayer('first')).toBe(layer)
    expect(map.getView()).toBe(view)
    runtime.destroy()
  })

  it('ignores superseded responses even when fetch does not obey cancellation', async () => {
    let resolve!: (response: Response) => void
    const response = new Promise<Response>(done => { resolve = done })
    const runtime = new OlDocumentRuntime({ map: new Map({ view: new View() }), fetch: vi.fn(() => response) })
    const old = runtime.loadDocument(document('old', true))
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    await runtime.loadDocument(document('current'))
    resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [] })))
    await rejected
    expect(runtime.getDocument()?.id).toBe('current')
    expect(runtime.getNativeMap().getLayers().getLength()).toBe(1)
    runtime.destroy()
  })

  it('rolls back a failed map attachment and leaves the prior layer usable', async () => {
    const map = new Map({ view: new View() }), runtime = new OlDocumentRuntime({ map })
    await runtime.loadDocument(document('first'))
    const previous = runtime.getLayer('first'), view = map.getView()
    vi.spyOn(map, 'setView').mockImplementationOnce(() => { throw new Error('Attachment failed') })
    await expect(runtime.loadDocument(document('second'))).rejects.toThrow('Attachment failed')
    expect(runtime.getDocument()?.id).toBe('first')
    expect(map.getLayers().getArray()).toEqual([previous])
    expect(map.getView()).toBe(view)
    runtime.destroy()
  })
})
