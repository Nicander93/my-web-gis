import { describe, expect, it } from 'vitest'
import { createDefaultLayerStyle, createProject, type ProjectSnapshot } from '@desktop-webgis/gis-core'
import { createCityScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { parseSceneDocument } from '@desktop-webgis/scene-schema'
import { createProjectFromSceneDocument, createProjectSceneDocument } from './project-scene-document'

function snapshot(): ProjectSnapshot {
  const project = createProject('Complete content')
  project.id = 'project'
  project.settings.workspaceType = '3d'
  project.datasets = [
    { id: 'shared', name: 'All points', kind: 'vector', source: { type: 'geojson-file', path: 'C:/private/input.geojson' } },
    { id: 'unused', name: 'Unused data', kind: 'vector', source: { type: 'memory', label: 'Empty' } },
    { id: 'wfs', name: 'WFS cache', kind: 'wfs', source: { type: 'wfs', url: 'https://example.test/wfs', version: '2.0.0', typeName: 'roads', authMode: 'bearer', credentialRef: { key: 'service-ref' }, maxFeatures: 5000, complete: false, loadedCount: 1, queryExtentWgs84: [0, 0, 1, 1], paginationUsed: true, truncatedByLimit: true } }
  ]
  project.layers = [
    { id: 'a', datasetId: 'shared', name: 'Filtered', visible: true, editable: true, opacity: 0.8, style: createDefaultLayerStyle('point'), filter: [{ field: 'value', op: 'gt', value: 1 }] },
    { id: 'b', datasetId: 'shared', name: 'Other display', visible: false, editable: false, opacity: 1, style: createDefaultLayerStyle('point'), filter: [{ field: 'value', op: 'lt', value: 2 }] },
    { id: 'cache', datasetId: 'wfs', name: 'Roads', visible: true, editable: false, opacity: 1, style: createDefaultLayerStyle('line') }
  ]
  project.groups = [{ id: 'group', name: 'Hidden group', visible: false, layerIds: ['a', 'b'] }, { id: 'empty', name: 'Empty group', visible: true, layerIds: [] }]
  project.rootOrder = [{ type: 'group', id: 'group' }, { type: 'layer', id: 'cache' }, { type: 'group', id: 'empty' }]
  project.city = createCityScene()
  project.city.assets.shared = { type: '3dtiles', url: './city/tileset.json' }
  project.city.assets.unused = { type: 'geojson', url: './city/unused.geojson' }
  project.city.groups = [{ id: 'group', name: 'City group', visible: true, locked: false }]
  project.city.nodes = [{ type: '3dtiles', id: 'a', name: 'Buildings', visible: true, groupId: 'group', asset: 'shared', transform: createTransform(), maximumScreenSpaceError: 4 }]
  return { project, featuresByDataset: {
    shared: [1, 2, 3].map(id => ({ id: String(id), geometry: { type: 'Point', coordinates: [id, 0] }, properties: { value: id, enabled: id === 1, label: id === 2 ? null : `Point ${id}` }, metadata: { sourceId: id, sourceCrs: 'EPSG:4326' } })),
    unused: [], wfs: [{ id: 'road-1', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'Road' } }]
  } }
}

describe('full project scene content', () => {
  it('retains unused city assets and explicitly scoped empty city groups without a city view', () => {
    const input = snapshot()
    delete input.project.city
    input.project.settings.workspaceType = '2d'
    const document = createProjectSceneDocument(input)
    document.resources.orphan = { type: 'glb', url: './models/orphan.glb' }
    document.nodes.push({ type: 'group', id: 'city-empty', name: 'Empty city group', visible: false, scope: '3d' })
    const restored = createProjectFromSceneDocument(document)
    expect(restored.project.city?.assets.orphan).toEqual({ type: 'glb', url: './models/orphan.glb' })
    expect(restored.project.city?.groups).toContainEqual({ id: 'city-empty', name: 'Empty city group', visible: false })
    expect(restored.project.settings.workspaceType).toBe('2d')
    expect(createProjectSceneDocument(restored).resources.orphan).toEqual(document.resources.orphan)
  })
  it('retains all data, shared identity, filters, local visibility and unused resources', () => {
    const input = snapshot(), before = JSON.stringify(input)
    const document = createProjectSceneDocument(input)
    expect(document.resources.shared).toMatchObject({ type: 'geojson', data: { features: [{ id: '1' }, { id: '2' }, { id: '3' }] }, fields: [{ name: 'value', type: 'number' }, { name: 'enabled', type: 'boolean' }, { name: 'label', type: 'string', nullable: true }] })
    expect(document.nodes.find(node => node.id === 'a')).toMatchObject({ resource: 'shared', visible: true, parentId: 'group', filter: [{ op: 'gt', value: 1 }] })
    expect(document.nodes.find(node => node.id === 'b')).toMatchObject({ resource: 'shared', visible: false, locked: true })
    expect(document.nodes.find(node => node.id === 'group')).toMatchObject({ type: 'group', scope: '2d', visible: false })
    expect(document.nodes.find(node => node.id === 'empty')).toBeDefined()
    expect(document.resources.unused).toMatchObject({ data: { features: [] } })
    expect(JSON.stringify(document)).not.toContain('C:/private')
    expect(JSON.stringify(input)).toBe(before)
  })
  it('round-trips mixed 2d/3d content including WFS origin, auth and cached completeness', () => {
    const document = createProjectSceneDocument(snapshot())
    const restored = createProjectFromSceneDocument(JSON.stringify(document))
    expect(restored.featuresByDataset.shared).toHaveLength(3)
    expect(restored.project.datasets.find(dataset => dataset.kind === 'wfs')).toMatchObject({ source: { typeName: 'roads', complete: false, truncatedByLimit: true, authMode: 'bearer', credentialRef: { key: 'service-ref' } } })
    expect(document.activeView).toBe('city')
    expect(createProjectSceneDocument(restored)).toEqual(document)
    expect(parseSceneDocument(JSON.stringify(document))).toEqual(document)
  })
  it('retains Provider credential references without embedding credential values', () => {
    const input = snapshot()
    input.project.basemap = { type: 'tianditu', mapType: 'imagery', projection: 'EPSG:4326', withLabels: true, credential: 'provider-ref' }
    const document = createProjectSceneDocument(input)
    expect(document.credentials?.['provider-ref']).toEqual({ type: 'runtime-reference', key: 'provider-ref' })
    expect(createProjectFromSceneDocument(document).project.basemap).toEqual(input.project.basemap)
  })
  it('rejects unsupported content before mutating the source document', () => {
    const document = createProjectSceneDocument(snapshot())
    document.extensions = { 'example.required': { version: 1, required: true, data: {} } }
    const before = JSON.stringify(document)
    expect(() => createProjectFromSceneDocument(document)).toThrow('扩展')
    expect(JSON.stringify(document)).toBe(before)
  })
  it('retains declared column types when a dataset has no features', () => {
    const input = snapshot()
    input.project.datasets[1].fields = [{ name: 'height', type: 'number', nullable: true }, { name: 'code', type: 'string', nullable: false }]
    const document = createProjectSceneDocument(input)
    expect(document.resources.unused.fields).toEqual(input.project.datasets[1].fields)
    const restored = createProjectFromSceneDocument(document)
    expect(restored.project.datasets.find(dataset => dataset.id === 'unused')?.fields).toEqual(input.project.datasets[1].fields)
    expect(createProjectSceneDocument(restored)).toEqual(document)
  })
  it('keeps numeric and string scene IDs distinct through the string-ID host model', () => {
    const document = createProjectSceneDocument(snapshot())
    const resource = document.resources.shared
    if (resource.type !== 'geojson' || !resource.data) throw new Error('Expected local data')
    resource.data.features[0].id = 1
    resource.data.features[1].id = '1'
    delete resource.featureMetadata
    const restored = createProjectFromSceneDocument(document)
    expect(new Set(restored.featuresByDataset.shared.map(feature => feature.id)).size).toBe(3)
    expect(createProjectSceneDocument(restored).resources.shared).toEqual(resource)
  })
  it('round-trips WMS and real WMTS matrices with query-token authentication', () => {
    const input = snapshot()
    input.project.datasets.push({ id: 'wms', name: 'Service', kind: 'wms', source: { type: 'wms', url: 'https://example.test/wms', version: '1.3.0', layerNames: ['roads'], authMode: 'query-token', tokenParam: 'tk', credentialRef: { key: 'query-ref' }, crs: 'EPSG:4326', bboxWgs84: [0, 0, 1, 1] } },
      { id: 'wmts', name: 'Matrix service', kind: 'wmts', source: { type: 'wmts', url: 'https://example.test/wmts', version: '1.0.0', layer: 'terrain', authMode: 'none', tileMatrixSet: 'set', requestEncoding: 'KVP', projection: 'EPSG:3857', tileMatrices: [{ identifier: 'level-A', scaleDenominator: 100000, topLeftCorner: [0, 1000], tileWidth: 256, tileHeight: 256, matrixWidth: 8, matrixHeight: 4 }] } })
    for (const id of ['wms', 'wmts']) { input.project.layers.push({ id, datasetId: id, name: id, visible: true, opacity: 1, editable: false, style: createDefaultLayerStyle() }); input.project.rootOrder.push({ type: 'layer', id }) }
    const document = createProjectSceneDocument(input)
    const restored = createProjectFromSceneDocument(document)
    expect(restored.project.datasets.find(dataset => dataset.id === 'wms')?.source).toEqual(input.project.datasets.find(dataset => dataset.id === 'wms')?.source)
    expect(restored.project.datasets.find(dataset => dataset.id === 'wmts')?.source).toEqual(input.project.datasets.find(dataset => dataset.id === 'wmts')?.source)
    expect(createProjectSceneDocument(restored)).toEqual(document)
  })
})
