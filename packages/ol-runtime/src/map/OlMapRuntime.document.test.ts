import { describe, expect, it, vi } from 'vitest'
import Collection from 'ol/Collection'
import Observable from 'ol/Observable'
import LayerGroup from 'ol/layer/Group'
import type View from 'ol/View'
import type BaseLayer from 'ol/layer/Base'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import type { GisFeature } from '@desktop-webgis/gis-core'
import type Feature from 'ol/Feature'
import type Geometry from 'ol/geom/Geometry'
import VectorSource from 'ol/source/Vector'
import { OlMapRuntime } from './OlMapRuntime'

vi.mock('ol/Map', () => ({ default: class extends Observable {
  root = new LayerGroup({ layers: [] })
  view: View
  constructor(options: { view: View }) { super(); this.view = options.view }
  getView() { return this.view }
  setView(view: View) { this.view = view }
  getLayerGroup() { return this.root }
  getLayers() { return this.root.getLayers() }
  addLayer(layer: BaseLayer) { this.getLayers().push(layer) }
  removeLayer(layer: BaseLayer) { this.getLayers().remove(layer) }
  setTarget() {}
} }))
vi.mock('ol/control', () => ({ defaults: () => new Collection(), ScaleLine: class {} }))
vi.mock('ol/interaction', () => ({ defaults: () => new Collection() }))

function fixture() {
  const features: GisFeature[] = [0, 1].map(value => ({ id: `host-${value}`, geometry: { type: 'Point', coordinates: [value, 0] }, properties: { value } }))
  const data = { type: 'FeatureCollection' as const, features: features.map((feature, index) => ({ type: 'Feature' as const, id: feature.id, geometry: feature.geometry, properties: { value: index } })) }
  const style = { mode: 'single' as const, symbol: { type: 'circle' as const, radius: 4, fill: { r: 255, g: 0, b: 0, a: 1 } } }
  const document: SceneDocument = { version: 3, id: 'project', title: 'Project', activeView: 'map', views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 3 } }, resources: { data: { type: 'geojson', data } }, nodes: [
    { type: 'group', id: 'group', name: 'Group', visible: true, scope: '2d' },
    { type: 'vector', id: 'first', name: 'First', resource: 'data', parentId: 'group', visible: true, style, filter: [{ field: 'value', op: 'eq', value: 0 }] },
    { type: 'vector', id: 'second', name: 'Second', resource: 'data', visible: true, style }
  ] }
  const runtime = new OlMapRuntime()
  runtime.mount({} as HTMLElement, { center: [0, 0], zoom: 2, rotation: 0 })
  return { runtime, document, features }
}

describe('Desktop portable OL document synchronization', () => {
  it('releases each host source once when closing during asynchronous preparation', async () => {
    const { runtime, document, features } = fixture()
    await runtime.syncDocument(document, { data: features })
    let resolve!: (response: Response) => void
    const response = new Promise<Response>(done => { resolve = done }), fetcher = vi.fn(() => response)
    vi.stubGlobal('fetch', fetcher)
    const dispose = vi.spyOn(VectorSource.prototype, 'dispose')
    try {
      const next = structuredClone(document)
      next.resources.provider = { type: 'provider', provider: 'google-map-tiles', mapType: 'roadmap', language: 'en-US', region: 'US', credential: 'provider' }
      next.credentials = { provider: { type: 'runtime-reference', key: 'provider' } }
      next.nodes.unshift({ type: 'tile', id: 'provider', name: 'Provider', resource: 'provider' })
      const pending = runtime.syncDocument(next, { data: [...features] }, { credentials: { provider: 'fixture' } })
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
      runtime.unmount()
      expect(await pending).toBe(false)
      resolve(new Response(JSON.stringify({ session: 'late', tileWidth: 256, tileHeight: 256 })))
      await new Promise(done => setTimeout(done, 0))
      expect(dispose).toHaveBeenCalledTimes(2)
      expect(new Set(dispose.mock.contexts).size).toBe(2)
      expect(runtime.registry.entries()).toEqual([])
    } finally { dispose.mockRestore(); vi.unstubAllGlobals() }
  })
  it('keeps the committed registry coherent after a failed follow-up update', async () => {
    const { runtime, document, features } = fixture()
    await runtime.syncDocument(document, { data: features })
    const changed: GisFeature[] = [{ ...features[0], geometry: { type: 'Point', coordinates: [2, 3] } }]
    document.resources.data = { type: 'geojson', data: { type: 'FeatureCollection', features: changed.map(feature => ({ type: 'Feature', id: feature.id, geometry: feature.geometry, properties: { value: 0 } })) } }
    const first = runtime.syncDocument(document, { data: changed })
    await first
    const installed = runtime.registry.getVector('first')!, source = installed.getSource()!
    const failed = structuredClone(document)
    failed.resources.provider = { type: 'provider', provider: 'google-map-tiles', mapType: 'roadmap', language: 'en-US', region: 'US', credential: 'missing' }
    failed.credentials = { missing: { type: 'runtime-reference', key: 'missing' } }
    failed.nodes.unshift({ type: 'tile', id: 'provider', name: 'Provider', resource: 'provider' })
    await expect(runtime.syncDocument(failed, { data: [...changed] })).rejects.toThrow('Credential')
    expect(runtime.registry.getVector('first')).toBe(installed)
    expect(installed.getSource()).toBe(source)
    runtime.unmount()
  })

  it('cancels a pending provider on project replacement and ignores its late successful response', async () => {
    const { runtime, document, features } = fixture()
    await runtime.syncDocument(document, { data: features })
    let resolve!: (response: Response) => void
    const response = new Promise<Response>(done => { resolve = done }), fetcher = vi.fn(() => response)
    vi.stubGlobal('fetch', fetcher)
    try {
      const pendingDocument = structuredClone(document)
      pendingDocument.resources.provider = { type: 'provider', provider: 'google-map-tiles', mapType: 'roadmap', language: 'en-US', region: 'US', credential: 'provider' }
      pendingDocument.credentials = { provider: { type: 'runtime-reference', key: 'provider' } }
      pendingDocument.nodes.unshift({ type: 'tile', id: 'provider', name: 'Provider', resource: 'provider' })
      const pending = runtime.syncDocument(pendingDocument, { data: [...features] }, { credentials: { provider: 'fixture' } })
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
      const next = structuredClone(document)
      next.id = 'new-project'; next.views.map = { type: '2d', projection: 'EPSG:4326', center: [10, 20], zoom: 4 }
      expect(await runtime.syncDocument(next, { data: features })).toBe(true)
      expect(await pending).toBe(false)
      const layer = runtime.registry.getVector('first')!, source = layer.getSource()! as VectorSource<Feature<Geometry>>
      resolve(new Response(JSON.stringify({ session: 'late', tileWidth: 256, tileHeight: 256 })))
      await new Promise(done => setTimeout(done, 0))
      expect(runtime.registry.getVector('first')).toBe(layer)
      expect(runtime.registry.get('provider')).toBeUndefined()
      expect(runtime.getMap().getView().getProjection().getCode()).toBe('EPSG:4326')
      expect(source.getFeatureById('host-1')?.getGeometry()?.getExtent()).toEqual([1, 0, 1, 0])
    } finally { runtime.unmount(); vi.unstubAllGlobals() }
  })
  it('shares complete host data, filters node operations and retains navigation and objects for presentation', async () => {
    const { runtime, document, features } = fixture()
    expect(await runtime.syncDocument(document, { data: features })).toBe(true)
    const first = runtime.registry.getVector('first')!, second = runtime.registry.getVector('second')!, source = first.getSource()! as VectorSource<Feature<Geometry>>
    expect(second.getSource()).toBe(source)
    expect(source.getFeatures()).toHaveLength(2)
    expect(runtime.registry.getDatasetIdForLayer('first')).toBe('data')
    expect(runtime.registry.getDatasetIdForLayer('second')).toBe('data')
    const selected = source.getFeatureById('host-0')!
    expect(runtime.isFeatureIncluded('first', selected)).toBe(true)
    expect(runtime.isFeatureIncluded('first', source.getFeatureById('host-1')!)).toBe(false)
    const view = runtime.getMap().getView()
    view.setCenter([100, 200]); view.setZoom(8)
    document.nodes[0].visible = false
    const node = document.nodes[1]
    if (node.type !== 'vector') throw new Error('Expected vector')
    node.opacity = .4
    await runtime.syncDocument(document, { data: features })
    expect(runtime.registry.getVector('first')).toBe(first)
    expect(first.getSource()).toBe(source)
    expect(source.getFeatureById('host-0')).toBe(selected)
    expect(runtime.isLayerVisible('first')).toBe(false)
    expect(runtime.isLayerVisible('second')).toBe(true)
    expect(runtime.getMap().getView()).toBe(view)
    expect(view.getCenter()).toEqual([100, 200])
    const disposed = vi.spyOn(source, 'dispose')
    runtime.unmount()
    expect(disposed).toHaveBeenCalledOnce()
  })

  it('retains installed content when preparation fails and replaces changed data after retry', async () => {
    const { runtime, document, features } = fixture()
    await runtime.syncDocument(document, { data: features })
    const layer = runtime.registry.getVector('first')!, source = layer.getSource()!, view = runtime.getMap().getView(), disposed = vi.spyOn(source, 'dispose')
    const next = structuredClone(document)
    next.resources.provider = { type: 'provider', provider: 'google-map-tiles', mapType: 'roadmap', language: 'en-US', region: 'US', credential: 'missing' }
    next.credentials = { missing: { type: 'runtime-reference', key: 'missing' } }
    next.nodes.unshift({ type: 'tile', id: 'provider', name: 'Provider', resource: 'provider' })
    await expect(runtime.syncDocument(next, { data: [...features] })).rejects.toThrow('Credential')
    expect(runtime.registry.getVector('first')).toBe(layer)
    expect(disposed).not.toHaveBeenCalled()
    expect(runtime.getMap().getView()).toBe(view)
    const changed: GisFeature[] = [{ ...features[0], geometry: { type: 'Point', coordinates: [3, 4] } }]
    document.resources.data = { type: 'geojson', data: { type: 'FeatureCollection', features: changed.map(feature => ({ type: 'Feature', id: feature.id, geometry: feature.geometry, properties: { value: 0 } })) } }
    await runtime.syncDocument(document, { data: changed })
    expect(runtime.registry.getVector('first')!.getSource()).not.toBe(source)
    expect(disposed).toHaveBeenCalledOnce()
    expect(runtime.getMap().getView()).toBe(view)
    runtime.unmount()
  })
})
