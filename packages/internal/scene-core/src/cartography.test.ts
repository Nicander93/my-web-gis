import { describe, expect, it } from 'vitest'
import { CARTOGRAPHY_EXTENSION, getSceneCartography, parseSceneDocument, type SceneNode } from '@desktop-webgis/scene-schema'
import { SceneController } from './controller.js'
import { addSceneNode, addSceneResource, createSceneDocument, removeSceneNode, removeSceneResource, replaceSceneNode } from './document.js'
import { mergeSceneDocuments } from './merge.js'
import { createSceneArchive } from './archive.js'
import { decodeSceneArchiveZip, encodeSceneArchiveZip } from './archive-zip.js'

function fixture() {
  const document = createSceneDocument({ id: 'scene', title: 'Drawing', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 5 } })
  document.extensions = { [CARTOGRAPHY_EXTENSION]: { version: 1, required: true, data: { specVersion: 8, bindings: [], styleLayers: [] } } }
  return addSceneResource(document, 'data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
}
const node: SceneNode = { type: 'vector', id: 'points', name: 'Points', resource: 'data', style: { mode: 'single', symbol: { type: 'circle', radius: 5, fill: { r: 255, g: 0, b: 0, a: 1 } } } }

describe('standard drawing scene lifecycle', () => {
  it('keeps embedded image bytes through ZIP and deduplicates content identities during merge', async () => {
    const document = addSceneNode(fixture(), node), state = getSceneCartography(document)!
    const text = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="#ff6600"/></svg>'
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const asset = { id: `asset-${hash}`, name: 'Marker', mimeType: 'image/svg+xml' as const, dataUrl: `data:image/svg+xml;base64,${btoa(text)}`, contentHash: hash, width: 16, height: 16, attribution: { source: 'Original', license: 'CC0-1.0' } }
    state.assets = [asset]
    state.styleLayers[0] = { id: state.styleLayers[0].id, type: 'symbol', source: state.bindings[0].styleSourceId, layout: { 'icon-image': asset.id } }
    const extension = document.extensions![CARTOGRAPHY_EXTENSION]
    extension.data = state as unknown as typeof extension.data
    const archive = await createSceneArchive(document, { readFile: async () => { throw new Error('unexpected external resource') } })
    const reopened = (await decodeSceneArchiveZip(await encodeSceneArchiveZip(archive))).document
    expect(getSceneCartography(reopened)!.assets).toEqual([asset])
    const merged = getSceneCartography(mergeSceneDocuments(document, reopened).document)!
    expect(merged.assets).toEqual([asset])
    expect(merged.styleLayers.filter(layer => layer.type === 'symbol').map(layer => layer.layout?.['icon-image'])).toEqual([asset.id, asset.id])
  })
  it('retains all drawing content through ZIP and remaps conflicting IDs during scene merge', async () => {
    const input = addSceneNode(fixture(), node)
    const entries = await createSceneArchive(input, { readFile: async () => { throw new Error('unexpected file') } })
    expect((await decodeSceneArchiveZip(await encodeSceneArchiveZip(entries))).document).toEqual(input)
    const merged = mergeSceneDocuments(input, input)
    const state = getSceneCartography(merged.document)!
    expect(state.bindings.map(binding => binding.gisLayerId)).toEqual(['points', merged.ids.nodes.points])
    expect(new Set(state.styleLayers.map(layer => layer.id)).size).toBe(state.styleLayers.length)
    expect(state.bindings[1].datasetId).toBe(merged.ids.resources.data)
    expect(state.bindings[0].styleSourceId).not.toBe(state.bindings[1].styleSourceId)
    const legacy = addSceneNode(fixture(), node)
    delete legacy.extensions
    expect(getSceneCartography(mergeSceneDocuments(legacy, input).document)!.bindings).toHaveLength(2)
    expect(getSceneCartography(mergeSceneDocuments(input, legacy).document)!.bindings).toHaveLength(2)
    const unknown = structuredClone(input)
    unknown.extensions!['org.example.unknown'] = { version: 1, required: false, data: { node: 'points' } }
    expect(() => mergeSceneDocuments(input, unknown)).toThrow('extension merge adapter')
  })
  it('adds/removes bindings for explicit operations; external documents reject dangling bindings', () => {
    let document = addSceneNode(fixture(), node)
    const binding = getSceneCartography(document)!.bindings[0]
    expect(binding).toMatchObject({ gisLayerId: 'points', datasetId: 'data' })
    document = addSceneNode(document, { ...node, id: 'another' })
    expect(getSceneCartography(document)!.bindings[1].styleSourceId).toBe(binding.styleSourceId)
    const malformed = structuredClone(document)
    malformed.nodes = []
    expect(() => parseSceneDocument(malformed)).toThrow()
    const removed = removeSceneNode(document, 'points')
    expect(getSceneCartography(removed)!.bindings.map(binding => binding.gisLayerId)).toEqual(['another'])
    expect(getSceneCartography(removeSceneResource(document, 'data', true))).toEqual({ specVersion: 8, bindings: [], styleLayers: [] })
  })

  it('retains advanced AST on visibility/rebinding and updates cache edits deliberately', () => {
    let document = addSceneNode(fixture(), node)
    const extension = document.extensions![CARTOGRAPHY_EXTENSION]
    const state = getSceneCartography(document)!
    const layer = state.styleLayers.find(layer => layer.type === 'circle')!
    if (layer.type === 'circle') layer.paint = { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 20, 12] }
    extension.data = state as unknown as typeof extension.data
    document = replaceSceneNode(document, node.id, { ...node, visible: false })
    expect(getSceneCartography(document)).toEqual(state)
    document = addSceneResource(document, 'replacement', document.resources.data)
    document = replaceSceneNode(document, node.id, { ...node, resource: 'replacement' })
    const rebound = getSceneCartography(document)!
    expect(rebound.bindings[0].datasetId).toBe('replacement')
    expect(rebound.styleLayers[0]).toMatchObject({ paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 20, 12] } })
    document = replaceSceneNode(document, node.id, { ...node, resource: 'replacement', style: { mode: 'single', symbol: { type: 'circle', radius: 9 } } })
    expect(getSceneCartography(document)!.styleLayers[0]).toMatchObject({ paint: { 'circle-radius': 9 } })
  })

  it('updates nested transaction deletions atomically', () => {
    const document = addSceneNode(addSceneNode(fixture(), { type: 'group', id: 'group', name: 'Group', visible: true }), { ...node, parentId: 'group' })
    const controller = new SceneController(document)
    controller.transaction('Remove group', draft => { draft.nodes = [] })
    expect(getSceneCartography(controller.getDocument())!.bindings).toEqual([])
    expect(getSceneCartography(removeSceneNode(document, 'group', true))!.styleLayers).toEqual([])
  })
})
