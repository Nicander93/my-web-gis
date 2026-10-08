import { describe, expect, it } from 'vitest'
import { createCityScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { getUnsupportedSceneExtensions, migrateSceneDocument, parseSceneDocument, validateSceneDocument } from './document.js'
import type { SceneManifestV1 } from './types.js'
import { parseScene } from './parse.js'

function legacy(): SceneManifestV1 {
  return { version: 1, id: 'legacy', title: 'Legacy map', view: { projection: 'EPSG:3857', center: [0, 0], zoom: 3 },
    sources: { shared: { type: 'geojson', data: { type: 'FeatureCollection', features: [1, 2].map(id => ({ type: 'Feature', id, properties: { value: id }, geometry: { type: 'Point', coordinates: [id, 0] } })) } } },
    layers: [{ id: 'same', name: 'Points', type: 'vector', source: 'shared', style: { type: 'point', radius: 5, fill: '#ffffff' }, interaction: { popup: { fields: [{ field: 'value' }] } } }] }
}

describe('unified scene document', () => {
  it('migrates v1 map styles, all data, popup and initial view without changing the input', () => {
    const input = legacy(), before = JSON.stringify(input)
    const document = migrateSceneDocument(input)
    expect(document.version).toBe(3)
    expect(document.nodes[0]).toMatchObject({ type: 'vector', resource: 'shared', style: { mode: 'single' }, interaction: { popup: { fields: [{ field: 'value' }] } } })
    expect(document.resources.shared).toMatchObject({ data: { features: [{ id: 1 }, { id: 2 }] } })
    expect(document.views.map).toMatchObject({ type: '2d', center: [0, 0], rotation: 0 })
    expect(JSON.stringify(input)).toBe(before)
    expect(parseSceneDocument(JSON.stringify(document))).toEqual(document)
  })
  it('remaps colliding resources, groups and nodes across 2d and 3d namespaces', () => {
    const input = parseScene(legacy()), city = createCityScene()
    city.assets.shared = { type: '3dtiles', url: './tiles/tileset.json' }
    city.groups = [{ id: 'same', name: 'Buildings', visible: false, locked: true }]
    city.nodes = [{ type: '3dtiles', id: 'same-2', name: 'Building', asset: 'shared', groupId: 'same', visible: true, transform: createTransform(), maximumScreenSpaceError: 8 }]
    input.city = city
    const document = migrateSceneDocument(input)
    expect(document.nodes).toMatchObject([{ id: 'same', resource: 'shared' }, { id: 'same-2', type: 'group', visible: false, locked: true }, { id: 'same-2-2', parentId: 'same-2', resource: 'shared-2', visible: true }])
    expect(document.resources['shared-2']).toEqual(city.assets.shared)
    expect(document.views.city).toEqual({ type: '3d', camera: city.camera, heightReference: 'ellipsoid' })
    expect(document.environment?.effects).toEqual(city.effects)
    expect(parseSceneDocument(document)).toEqual(document)
  })
  it('reads standalone legacy city scenes with an explicit document identity', () => {
    const city = { ...createCityScene(), version: 1 }
    const document = migrateSceneDocument(city, { id: 'old-city', title: 'Old city' })
    expect(document).toMatchObject({ id: 'old-city', title: 'Old city', activeView: 'city', views: { city: { type: '3d' } } })
  })
  it('validates filters while retaining complete shared resource data', () => {
    const document = migrateSceneDocument(legacy())
    const node = document.nodes[0]
    if (node.type !== 'vector') throw new Error('Expected vector')
    node.filter = [{ field: 'value', op: 'gt', value: 1 }]
    expect(parseSceneDocument(document).resources).toEqual(document.resources)
    const invalid = { ...document, nodes: [{ ...node, filter: [{ field: 'value', op: 'eval', value: 'alert(1)' }] }] }
    expect(validateSceneDocument(invalid).issues.some(issue => issue.code === 'node.filter')).toBe(true)
  })
  it('rejects missing resources, active views, duplicate IDs and group cycles', () => {
    const document = migrateSceneDocument(legacy())
    expect(validateSceneDocument({ ...document, resources: {} }).valid).toBe(false)
    expect(validateSceneDocument({ ...document, activeView: 'missing' }).valid).toBe(false)
    expect(validateSceneDocument({ ...document, nodes: [...document.nodes, document.nodes[0]] }).valid).toBe(false)
    const cyclic = { ...document, nodes: [{ type: 'group', id: 'a', name: 'A', visible: true, parentId: 'b' }, { type: 'group', id: 'b', name: 'B', visible: true, parentId: 'a' }] }
    expect(validateSceneDocument(cyclic).issues.some(issue => issue.code === 'group.cycle')).toBe(true)
  })
  it('preserves unknown extensions and reports unsupported required versions', () => {
    const document = migrateSceneDocument(legacy())
    document.extensions = { 'example.custom': { version: 2, required: true, data: { value: 'preserve me' } } }
    expect(parseSceneDocument(JSON.stringify(document)).extensions).toEqual(document.extensions)
    expect(getUnsupportedSceneExtensions(document)[0].code).toBe('extension.required')
    expect(getUnsupportedSceneExtensions(document, { 'example.custom': [1] })).toHaveLength(1)
    expect(getUnsupportedSceneExtensions(document, { 'example.custom': [2] })).toEqual([])
  })
  it('rejects unknown versions, runtime objects, cyclic metadata and nonfinite JSON', () => {
    const document = migrateSceneDocument(legacy())
    expect(() => parseSceneDocument({ ...document, version: 99 })).toThrow()
    expect(() => parseSceneDocument({ ...document, metadata: { object: new Date() } })).toThrow()
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    expect(validateSceneDocument({ ...document, metadata: cycle }).valid).toBe(false)
    expect(validateSceneDocument({ ...document, metadata: { value: Infinity } }).valid).toBe(false)
  })
  it('validates dictionary keys as own resources without prototype inheritance', () => {
    const document = migrateSceneDocument(legacy())
    const node = document.nodes[0]
    expect(validateSceneDocument({ ...document, nodes: [{ ...node, resource: 'constructor' }] }).valid).toBe(false)
    const resources = JSON.parse('{"__proto__":{"type":"unsupported"}}')
    expect(validateSceneDocument({ ...document, resources, nodes: [] }).valid).toBe(false)
  })
})
