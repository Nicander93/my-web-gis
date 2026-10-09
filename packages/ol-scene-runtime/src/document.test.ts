import { describe, expect, it, vi } from 'vitest'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import VectorLayer from 'ol/layer/Vector.js'
import LayerGroup from 'ol/layer/Group.js'
import VectorSource from 'ol/source/Vector.js'
import { createOlDocumentLayers, getSceneFeatureId } from './document.js'

function document(): SceneDocument {
  const style = { mode: 'single' as const, symbol: { type: 'circle' as const, radius: 4, fill: { r: 255, g: 0, b: 0, a: 1 } } }
  return { version: 3, id: 'scene', title: 'Scene', activeView: 'map', views: { map: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 2 } }, resources: {
    data: { type: 'geojson', data: { type: 'FeatureCollection', features: [1, '1', 2].map((id, index) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [index, 0] }, properties: { value: index } })) } }
  }, nodes: [{ type: 'group', id: 'parent', name: 'Parent', visible: false, scope: '2d' },
    { type: 'vector', id: 'first', name: 'First', resource: 'data', parentId: 'parent', visible: true, style, filter: [{ field: 'value', op: 'gt', value: 0 }] },
    { type: 'vector', id: 'second', name: 'Second', resource: 'data', visible: true, style, filter: [{ field: 'value', op: 'eq', value: 0 }] }] }
}

describe('v3 OL document factory', () => {
  it('releases already prepared shared sources on abort before a later fetch returns', async () => {
    const input = document(), operation = new AbortController()
    input.resources.remote = { type: 'geojson', url: './remote.geojson' }
    const first = input.nodes.find(node => node.type === 'vector')!
    input.nodes.push({ ...first, id: 'remote', resource: 'remote' })
    let resolve!: (response: Response) => void
    const response = new Promise<Response>(done => { resolve = done }), fetcher = vi.fn(() => response)
    const disposed = vi.spyOn(VectorSource.prototype, 'dispose')
    const pending = createOlDocumentLayers(input, { signal: operation.signal, fetch: fetcher })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    operation.abort()
    expect(disposed).toHaveBeenCalledOnce()
    resolve(new Response(JSON.stringify({ type: 'FeatureCollection', features: [] })))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(disposed).toHaveBeenCalledOnce()
    disposed.mockRestore()
  })
  it('retains sources and native presentation when unrelated city or metadata content changes', async () => {
    const input = document(), result = await createOlDocumentLayers(input)
    const layer = result.getLayer('first') as VectorLayer, source = layer.getSource()!, style = layer.getStyle()
    const next = structuredClone(input)
    next.title = 'Mixed scene'; next.resources.city = { type: '3dtiles', url: './tileset.json' }
    next.nodes.push({ type: '3dtiles', id: 'city', name: 'Buildings', visible: true, resource: 'city', transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } })
    expect(result.updatePresentation(next)).toBe(true)
    expect(layer.getSource()).toBe(source); expect(layer.getStyle()).toBe(style)
    expect(result.getDocument()).toEqual(next)
    expect(result.issues).toContainEqual(expect.objectContaining({ path: '$.nodes.city', code: 'ol.unsupported' }))
    next.nodes.pop(); delete next.resources.city
    expect(result.updatePresentation(next)).toBe(true)
    expect(result.issues.some(issue => issue.path === '$.nodes.city')).toBe(false)
    result.dispose()
  })
  it('updates styles and filters while preserving shared data and layer identity', async () => {
    const input = document(), result = await createOlDocumentLayers(input)
    const layer = result.getLayer('first') as VectorLayer, source = layer.getSource()!
    const next = structuredClone(input), node = next.nodes[1]
    if (node.type !== 'vector') throw new Error('Expected vector')
    node.filter = [{ field: 'value', op: 'eq', value: 0 }]
    node.opacity = 0.3
    next.nodes[0].visible = true
    expect(result.updatePresentation(next)).toBe(true)
    expect(result.getLayer('first')).toBe(layer)
    expect(layer.getSource()).toBe(source)
    expect(source.getFeatures()).toHaveLength(3)
    expect(layer.getOpacity()).toBe(0.3)
    expect(result.getFilteredFeatures('first').map(getSceneFeatureId)).toEqual([1])
    expect(layer.getStyleFunction()!(source.getFeatures()[0], 1)).toBeDefined()
    expect(layer.getStyleFunction()!(source.getFeatures()[1], 1)).toBeUndefined()
    delete node.filter
    expect(result.updatePresentation(next)).toBe(true)
    expect(result.getFilteredFeatures('first')).toHaveLength(3)
    expect(layer.getStyleFunction()!(source.getFeatures()[1], 1)).toBeDefined()
    expect(result.getDocument()).toEqual(next)
    const invalid = structuredClone(next)
    const invalidNode = invalid.nodes[1]
    if (invalidNode.type !== 'vector') throw new Error('Expected vector')
    invalidNode.opacity = 2
    expect(() => result.updatePresentation(invalid)).toThrow()
    expect(layer.getOpacity()).toBe(0.3)
    expect(result.getDocument()).toEqual(next)
    next.resources.extra = { type: 'xyz', url: 'https://example.test/{z}/{x}/{y}.png' }
    expect(result.updatePresentation(next)).toBe(true)
    expect(result.getDocument().resources.extra).toEqual(next.resources.extra)
    expect(layer.getSource()).toBe(source)
    next.resources.data = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }
    expect(result.updatePresentation(next)).toBe(false)
    expect(source.getFeatures()).toHaveLength(3)
    result.dispose()
  })
  it('shares full data, retains typed identities and applies independent node filters', async () => {
    const input = document(), before = JSON.stringify(input), result = await createOlDocumentLayers(input)
    const first = result.getLayer('first') as VectorLayer, second = result.getLayer('second') as VectorLayer
    expect(first.getSource()).toBe(second.getSource())
    const source = first.getSource()!, features = source.getFeatures()
    expect(features).toHaveLength(3)
    expect(features.map(getSceneFeatureId)).toEqual([1, '1', 2])
    expect(first.getStyleFunction()!(features[0], 1)).toBeUndefined()
    expect(second.getStyleFunction()!(features[0], 1)).toBeDefined()
    expect(first.getStyleFunction()!(features[1], 1)).toBeDefined()
    expect(second.getStyleFunction()!(features[1], 1)).toBeUndefined()
    expect(result.getFilteredFeatures('first').map(getSceneFeatureId)).toEqual(['1', 2])
    expect(result.getFilteredFeatures('second').map(getSceneFeatureId)).toEqual([1])
    const parent = result.rootLayers[0] as LayerGroup
    expect(parent.getVisible()).toBe(false)
    expect(parent.getLayers().item(0)).toBe(first)
    expect(first.getVisible()).toBe(true)
    expect(result.getDocument()).toEqual(input)
    expect(JSON.stringify(input)).toBe(before)
    const dispose = vi.spyOn(source, 'dispose')
    result.dispose(); result.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported 3d nodes while retaining their portable definitions', async () => {
    const input = document()
    input.resources.model = { type: 'glb', url: './model.glb' }
    input.nodes.push({ type: 'group', id: 'city', name: 'City', visible: true, scope: '3d' })
    input.nodes.push({ type: 'model', id: 'model', name: 'Model', visible: true, position: [0, 0, 0], resource: 'model', parentId: 'city', transform: { translation: [0, 0, 0], rotation: [0, 0, 0], scale: 1 } })
    const result = await createOlDocumentLayers(input)
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ol.unsupported', path: '$.nodes.city' }))
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ol.unsupported', path: '$.nodes.model' }))
    expect(result.getDocument()).toEqual(input)
    result.dispose()
  })

  it('rejects unknown required extensions before creating native objects', async () => {
    const input = document()
    const result = await createOlDocumentLayers(input), before = result.getDocument(), layer = result.getLayer('first')
    input.extensions = { 'example.required': { version: 1, required: true, data: {} } }
    expect(() => result.updatePresentation(input)).toThrow()
    expect(result.getDocument()).toEqual(before); expect(result.getLayer('first')).toBe(layer)
    result.dispose()
    await expect(createOlDocumentLayers(input)).rejects.toThrow()
  })
  it('uses a WFS saved cache without making remote requests or claiming completeness', async () => {
    const input = document(), data = input.resources.data
    if (data.type !== 'geojson' || !data.data) throw new Error('Expected inline data')
    input.resources.data = { type: 'wfs', url: 'https://example.test/wfs', version: '2.0.0', typeName: 'points', authMode: 'none', snapshot: data.data, loadedCount: 3, complete: false, truncatedByLimit: true }
    const fetcher = vi.fn(), result = await createOlDocumentLayers(input, { fetch: fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'wfs.snapshot' }))
    expect(result.getDocument().resources.data).toMatchObject({ complete: false, truncatedByLimit: true })
    result.dispose()
  })
  it('prepares a remote shared GeoJSON resource once and retains its portable URL', async () => {
    const input = document(), resource = input.resources.data
    if (resource.type !== 'geojson') throw new Error('Expected GeoJSON')
    const content = resource.data
    input.resources.data = { type: 'geojson', url: './points.geojson' }
    const fetcher = vi.fn(async () => new Response(JSON.stringify(content)))
    const result = await createOlDocumentLayers(input, { fetch: fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect((result.getLayer('first') as VectorLayer).getSource()?.getFeatures()).toHaveLength(3)
    expect(result.getDocument()).toEqual(input)
    result.dispose()
  })
  it('uses declared ID fields and refuses duplicate identities instead of dropping features', async () => {
    const input = document(), resource = input.resources.data
    if (resource.type !== 'geojson' || !resource.data) throw new Error('Expected data')
    resource.idField = 'code'
    resource.data.features.forEach((feature, index) => { delete feature.id; feature.properties = { code: index === 0 ? 1 : String(index), value: index } })
    const result = await createOlDocumentLayers(input)
    expect((result.getLayer('first') as VectorLayer).getSource()?.getFeatures().map(getSceneFeatureId)).toEqual([1, '1', '2'])
    result.dispose()
    resource.data.features[2].properties = { code: '1' }
    await expect(createOlDocumentLayers(input)).rejects.toThrow('Duplicate feature identity')
  })
  it('releases previously prepared shared sources when a later remote resource fails', async () => {
    const input = document()
    input.resources.remote = { type: 'geojson', url: './invalid.geojson' }
    const node = input.nodes[2]
    if (node.type !== 'vector') throw new Error('Expected vector')
    node.resource = 'remote'
    const dispose = vi.spyOn(VectorSource.prototype, 'dispose')
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1] }, properties: {} }] })))
    await expect(createOlDocumentLayers(input, { fetch: fetcher })).rejects.toThrow('geometry')
    expect(dispose).toHaveBeenCalledTimes(1)
    dispose.mockRestore()
  })
})
