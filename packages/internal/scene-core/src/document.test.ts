import { describe, expect, it } from 'vitest'
import { parseSceneDocument } from '@desktop-webgis/scene-schema'
import { addSceneNode, addSceneResource, createSceneDocument, moveSceneNode, removeSceneNode, removeSceneResource, replaceSceneResource, serializeSceneDocument, setSceneDocumentView, setSceneEnvironment } from './document.js'

function scene() {
  const document = createSceneDocument({ id: 'scene', title: 'Scene', viewId: 'map', view: { type: '2d', projection: 'EPSG:3857', center: [0, 0], zoom: 3 } })
  return addSceneResource(document, 'data', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
}

describe('pure unified scene operations', () => {
  it('shares one resource among display nodes and rejects incompatible replacements', () => {
    const original = scene(), before = JSON.stringify(original)
    const style = { mode: 'single' as const, symbol: { type: 'circle' as const, radius: 4 } }
    const document = addSceneNode(addSceneNode(original, { id: 'a', name: 'A', type: 'vector', resource: 'data', style }), { id: 'b', name: 'B', type: 'vector', resource: 'data', style })
    expect(Object.keys(document.resources)).toEqual(['data'])
    expect(() => removeSceneResource(document, 'data')).toThrow('仍被节点引用')
    expect(removeSceneResource(document, 'data', true).nodes).toEqual([])
    expect(() => replaceSceneResource(document, 'data', { type: 'glb', url: './model.glb' })).toThrow()
    expect(JSON.stringify(original)).toBe(before)
  })
  it('moves nested groups, rejects cycles and requires explicit subtree deletion', () => {
    const a = addSceneNode(scene(), { type: 'group', id: 'a', name: 'A', visible: false })
    const b = addSceneNode(a, { type: 'group', id: 'b', name: 'B', visible: true, parentId: 'a' })
    expect(() => moveSceneNode(b, 'a', 0, 'b')).toThrow('循环')
    expect(() => removeSceneNode(b, 'a')).toThrow('子节点')
    expect(removeSceneNode(b, 'a', true).nodes).toEqual([])
    const moved = moveSceneNode(b, 'b', 0)
    expect(moved.nodes[0]).not.toHaveProperty('parentId')
    expect(moved.nodes[1].visible).toBe(false)
  })
  it('updates engine views independently and round-trips environment and filters', () => {
    const original = scene()
    const document = setSceneDocumentView(original, 'city', { type: '3d', camera: { position: [0, 0, 1000], heading: 0, pitch: -45, roll: 0 }, heightReference: 'ellipsoid' }, true)
    expect(document.views.map).toEqual(original.views.map)
    expect(original.activeView).toBe('map')
    const environment = setSceneEnvironment(document, { effects: { fog: 0.3, bloom: true } })
    expect(parseSceneDocument(serializeSceneDocument(environment))).toEqual(environment)
  })
})
