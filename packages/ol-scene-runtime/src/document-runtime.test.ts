import { describe, expect, it, vi } from 'vitest'
import Collection from 'ol/Collection.js'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
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
  it('retains host feature objects through document replacement and teardown', async () => {
    const feature = new Feature({ geometry: new Point([10, 20]) })
    feature.setId('editable')
    const source = new VectorSource({ features: [feature] }), disposed = vi.spyOn(source, 'dispose')
    const runtime = new OlDocumentRuntime({ map: new Map({ view: new View() }), vectorSources: { data: source } })
    await runtime.loadDocument(document('first'))
    const first = runtime.getLayer('first') as VectorLayer
    expect(first.getSource()).toBe(source)
    await runtime.loadDocument(document('second'))
    expect((runtime.getLayer('second') as VectorLayer).getSource()).toBe(source)
    expect(runtime.getFilteredFeatures('second')).toEqual([feature])
    expect(source.getFeatureById('editable')).toBe(feature)
    runtime.destroy()
    expect(disposed).not.toHaveBeenCalled()
    expect(source.getFeatureById('editable')).toBe(feature)
    source.dispose()
  })
  it('rejects cancellation immediately while an uncooperative fetch is still pending', async () => {
    let resolve!: (response: Response) => void
    const response = new Promise<Response>(done => { resolve = done })
    const runtime = new OlDocumentRuntime({ map: new Map({ view: new View() }), fetch: vi.fn(() => response) })
    await runtime.loadDocument(document('first'))
    const layer = runtime.getLayer('first')
    const pending = runtime.loadDocument(document('pending', true)), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    runtime.cancelPreparation()
    await rejected
    expect(runtime.getLayer('first')).toBe(layer)
    resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [] })))
    await Promise.resolve(); await Promise.resolve()
    expect(runtime.getDocument()?.id).toBe('first')
    runtime.destroy()
  })

  it('retains navigation made while replacement data is being prepared', async () => {
    let resolve!: (response: Response) => void
    const response = new Promise<Response>(done => { resolve = done })
    const runtime = new OlDocumentRuntime({ map: new Map({ view: new View() }), fetch: vi.fn(() => response) })
    await runtime.loadDocument(document('first'))
    const view = runtime.getNativeMap().getView(), next = document('first', true)
    const pending = runtime.updateDocument(next)
    view.setCenter([900, 800]); view.setZoom(8)
    resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [] })))
    await pending
    expect(runtime.getNativeMap().getView()).toBe(view)
    expect(view.getCenter()).toEqual([900, 800]); expect(view.getZoom()).toBe(8)
    runtime.destroy()
  })
  it('reuses presentation layers but prepares replacements for changed resources', async () => {
    const runtime = new OlDocumentRuntime({ map: new Map({ view: new View() }) })
    const input = document('first')
    await runtime.loadDocument(input)
    const layer = runtime.getLayer('first'), view = runtime.getNativeMap().getView()
    view.setCenter([123, 456]); view.setZoom(7); view.setRotation(.4)
    input.nodes[0].visible = false
    await runtime.updateDocument(input)
    expect(runtime.getLayer('first')).toBe(layer)
    expect(layer?.getVisible()).toBe(false)
    expect(runtime.getNativeMap().getView()).toBe(view)
    expect(runtime.getDocument()).toEqual(input)
    input.resources.data = { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 1, properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }] } }
    await runtime.updateDocument(input)
    expect(runtime.getLayer('first')).not.toBe(layer)
    expect(runtime.getFilteredFeatures('first')).toHaveLength(1)
    expect(runtime.getNativeMap().getView()).toBe(view)
    expect(view.getCenter()).toEqual([123, 456]); expect(view.getZoom()).toBe(7); expect(view.getRotation()).toBe(.4)
    input.views.map = { type: '2d', projection: 'EPSG:3857', center: [10, 20], zoom: 3 }
    await runtime.updateDocument(input)
    expect(runtime.getNativeMap().getView()).not.toBe(view)
    expect(runtime.getNativeMap().getView().getCenter()).toEqual([10, 20])
    runtime.destroy()
  })
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

  it('restores the external original view after same-document replacements retain the navigated view', async () => {
    const original = new View(), map = new Map({ view: original }), runtime = new OlDocumentRuntime({ map })
    const input = document('first')
    await runtime.loadDocument(input)
    const installed = map.getView()
    installed.setCenter([100, 200])
    input.resources.data = { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'new', properties: {}, geometry: { type: 'Point', coordinates: [1, 1] } }] } }
    await runtime.updateDocument(input)
    expect(map.getView()).toBe(installed)
    runtime.destroy()
    expect(map.getView()).toBe(original)
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
