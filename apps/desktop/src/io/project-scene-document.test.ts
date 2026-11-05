import { requireMapContent } from '@desktop-webgis/project'
import { describe, expect, it } from 'vitest'
import { createDefaultLayerStyle, createProject, getLayerCartography, prepareProjectContent, setLayerCartography, parseProjectSnapshot, serializeProjectSnapshot, type ProjectSnapshot } from '@desktop-webgis/project'
import { createBillboardStyle, createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { CARTOGRAPHY_EXTENSION, parseSceneDocument } from '@desktop-webgis/scene-schema'
import { createProjectFromSceneDocument, createProjectSceneDocument, createProjectSceneProjection } from './project-scene-document'
import { createCategorizedStyle, createGraduatedStyle } from '@desktop-webgis/ol-style'

function snapshot(kind: 'map2d' | 'scene3d' = 'map2d'): ProjectSnapshot {
  const project = createProject('Complete content', kind)
  project.metadata.id = 'project'
  if (kind === 'scene3d') {
    const scene = createCesiumScene()
    scene.assets.shared = { type: '3dtiles', url: './city/tileset.json' }
    scene.assets.unused = { type: 'geojson', url: './city/unused.geojson' }
    scene.groups = [{ id: 'group', name: 'Scene group', visible: true, locked: false }]
    scene.nodes = [{ type: '3dtiles', id: 'a', name: 'Buildings', visible: true, groupId: 'group', asset: 'shared', transform: createTransform(), maximumScreenSpaceError: 4 }]
    project.content = { kind, scene, settings: {} }
    return { project, featuresByDataset: {} }
  }
  requireMapContent(project).datasets = [
    { id: 'shared', name: 'All points', kind: 'vector', source: { type: 'geojson-file', path: 'C:/private/input.geojson' } },
    { id: 'unused', name: 'Unused data', kind: 'vector', source: { type: 'memory', label: 'Empty' } },
    { id: 'wfs', name: 'WFS cache', kind: 'wfs', source: { type: 'wfs', url: 'https://example.test/wfs', version: '2.0.0', typeName: 'roads', authMode: 'bearer', credentialRef: { key: 'service-ref' }, maxFeatures: 5000, complete: false, loadedCount: 1, queryExtentWgs84: [0, 0, 1, 1], paginationUsed: true, truncatedByLimit: true } }
  ]
  requireMapContent(project).layers = [
    { id: 'a', datasetId: 'shared', name: 'Filtered', visible: true, editable: true, opacity: 0.8, style: createDefaultLayerStyle('point'), filter: [{ field: 'value', op: 'gt', value: 1 }] },
    { id: 'b', datasetId: 'shared', name: 'Other display', visible: false, editable: false, locked: true, opacity: 1, style: createDefaultLayerStyle('point'), filter: [{ field: 'value', op: 'lt', value: 2 }] },
    { id: 'cache', datasetId: 'wfs', name: 'Roads', visible: true, editable: false, opacity: 1, style: createDefaultLayerStyle('line') }
  ]
  requireMapContent(project).groups = [{ id: 'group', name: 'Hidden group', visible: false, layerIds: ['a', 'b'] }, { id: 'empty', name: 'Empty group', visible: true, layerIds: [] }]
  requireMapContent(project).rootOrder = [{ type: 'group', id: 'group' }, { type: 'layer', id: 'cache' }, { type: 'group', id: 'empty' }]
  return { project, featuresByDataset: {
    shared: [1, 2, 3].map(id => ({ id: String(id), geometry: { type: 'Point', coordinates: [id, 0] }, properties: { value: id, enabled: id === 1, label: id === 2 ? null : `Point ${id}` }, metadata: { sourceId: id, sourceCrs: 'EPSG:4326' } })),
    unused: [], wfs: [{ id: 'road-1', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'Road' } }]
  } }
}

describe('full project scene content', () => {
  it('projects only explicit local locks while leaving old editable false layers unlocked', () => {
    const input = snapshot(), document = createProjectSceneDocument(input)
    expect(document.nodes.find(node => node.id === 'cache')).toMatchObject({ locked: false })
    expect(document.nodes.find(node => node.id === 'b')).toMatchObject({ locked: true })
    const restored = createProjectFromSceneDocument(document)
    expect(requireMapContent(restored.project).layers.find(layer => layer.id === 'b')?.locked).toBe(true)
    expect(requireMapContent(restored.project).layers.find(layer => layer.id === 'cache')?.locked).toBe(false)
  })

  it('preserves native tileset style and parameter overrides through project save and v3 projection', () => {
    const input = snapshot('scene3d')
    const node = input.project.content.scene!.nodes[0]
    if (node.type !== '3dtiles') throw new Error('Expected tileset fixture')
    Object.assign(node, { style: { defines: { height: '${Height}' }, color: { conditions: [['${height} > 30', 'color("red")'], ['true', 'color("white")']] }, meta: { label: '${name}' } }, cacheBytes: 134217728, dynamicScreenSpaceError: false, dynamicScreenSpaceErrorDensity: .0005, dynamicScreenSpaceErrorFactor: 12, skipLevelOfDetail: true })
    const saved = parseProjectSnapshot(serializeProjectSnapshot(input))
    const document = createProjectSceneDocument(saved)
    const projected = document.nodes.find(item => item.name === node.name)
    expect(projected).toMatchObject({ style: node.style, cacheBytes: node.cacheBytes, dynamicScreenSpaceError: false, dynamicScreenSpaceErrorDensity: .0005, dynamicScreenSpaceErrorFactor: 12, skipLevelOfDetail: true })
    const restored = createProjectFromSceneDocument(JSON.stringify(document))
    expect(restored.project.content.scene!.nodes.find(item => item.name === node.name)).toMatchObject({ style: node.style, cacheBytes: node.cacheBytes, dynamicScreenSpaceError: false, dynamicScreenSpaceErrorDensity: .0005, dynamicScreenSpaceErrorFactor: 12, skipLevelOfDetail: true })
    expect(createProjectSceneDocument(restored)).toEqual(document)
  })
  it('round trips standard drawing expressions and shared-source binding IDs through a required scene extension', () => {
    const input = snapshot()
    input.project = prepareProjectContent(input.project)
    const binding = getLayerCartography(input.project, 'a')!.binding
    input.project = setLayerCartography(input.project, 'a', [{ id: 'advanced', type: 'circle', source: binding.styleSourceId,
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 20, 12], 'circle-color': '#ff0000' } }])
    const document = createProjectSceneDocument(input)
    expect(document.extensions?.[CARTOGRAPHY_EXTENSION]).toMatchObject({ version: 1, required: true })
    const restored = createProjectFromSceneDocument(JSON.parse(JSON.stringify(document)))
    expect(requireMapContent(restored.project).cartography).toEqual(requireMapContent(input.project).cartography)
    expect(createProjectSceneDocument(restored).extensions).toEqual(document.extensions)
    const malformed = structuredClone(document)
    malformed.nodes = malformed.nodes.filter(node => node.id !== 'a')
    expect(() => parseSceneDocument(malformed)).toThrow()
  })
  it.each(['rectangle','ellipse'] as const)('preserves %s geometry in portable documents', type => {
    const input = snapshot('scene3d'), scene = createCesiumScene()
    scene.nodes = [{ id: type, name: type, visible: true, type: 'graphic', geometry: { type, positions: [[116,39,12],[116.01,39.02,12]], heightMode: 'absolute' }, style: { color: '#336699', width: 3, pointSize: 10 }, properties: { code: '001' } }]
    input.project.content.scene = scene
    expect(createProjectFromSceneDocument(JSON.stringify(createProjectSceneDocument(input))).project.content.scene?.nodes).toEqual(scene.nodes)
  })
  it('preserves point billboard style and label in portable documents', () => {
    const input = snapshot('scene3d'), scene = createCesiumScene()
    scene.nodes = [{ id: 'icon', name: 'Icon', visible: true, type: 'graphic', geometry: { type: 'point', positions: [[116,39,12]], heightMode: 'absolute' }, style: { color: '#336699', width: 3, pointSize: 10, label: 'POI', billboard: createBillboardStyle() }, properties: { name: 'Icon' } }]
    input.project.content.scene = scene
    const restored = createProjectFromSceneDocument(JSON.stringify(createProjectSceneDocument(input)))
    expect(restored.project.content.scene?.nodes).toEqual(scene.nodes)
  })
  it('keeps local three-dimensional GeoJSON references and unused assets outside map datasets', () => {
    const project = createProject('Local assets', 'scene3d'); project.content.scene = createCesiumScene()
    project.content.scene.assets.points = { type: 'geojson', reference: { kind: 'relative', path: '数据/points.geojson' } }
    project.content.scene.assets.unused = { type: 'glb', reference: { kind: 'absolute', path: 'D:/模型/model.glb' } }
    project.content.scene.nodes.push({ type: 'geojson', id: 'points', name: 'Points', visible: true, asset: 'points' })
    const document = createProjectSceneDocument({ project, featuresByDataset: {} })
    const restored = createProjectFromSceneDocument(document)
    expect(restored.project.content.scene!.assets).toEqual(project.content.scene.assets)
    expect(restored.project.content.scene!.nodes).toEqual(project.content.scene.nodes)
    expect(restored.project.content).not.toHaveProperty('datasets')
    expect(createProjectSceneDocument(restored).resources).toEqual(document.resources)
  })
  it('keeps nested folders in each workspace and rejects mixed imports without changing the input', () => {
    const input = snapshot()
    requireMapContent(input.project).groups.push({ id: 'child', name: 'Map child', parentId: 'group', visible: true, locked: true, layerIds: ['a'] })
    requireMapContent(input.project).groups[0].layerIds = ['b']
    requireMapContent(input.project).groups[0].childOrder = [{ type: 'group', id: 'child' }, { type: 'layer', id: 'b' }]
    const document = createProjectSceneDocument(input)
    expect(document.nodes.find(node => node.id === 'child')).toMatchObject({ type: 'group', parentId: 'group', locked: true })
    const restored = createProjectFromSceneDocument(document)
    expect(requireMapContent(restored.project).groups.find(group => group.id === 'child')).toMatchObject({ parentId: 'group', locked: true, layerIds: ['a'] })
    expect(parseProjectSnapshot(serializeProjectSnapshot(restored)).project.content).toEqual(restored.project.content)
    const scene3d = snapshot('scene3d')
    scene3d.project.content.scene!.groups!.push({ id: 'child', name: 'Scene child', parentId: 'group', visible: false })
    scene3d.project.content.scene!.nodes[0].groupId = 'child'
    const again = createProjectSceneDocument(parseProjectSnapshot(serializeProjectSnapshot(scene3d)))
    expect(again.nodes.find(node => node.name === 'Scene child')?.parentId).toBe(again.nodes.find(node => node.name === 'Scene group')?.id)
    const mixed = structuredClone(document)
    mixed.resources.city = { type: '3dtiles', url: './city/tileset.json' }
    mixed.nodes.push({ id: 'city-node', name: 'Scene node', type: '3dtiles', resource: 'city', visible: true, transform: createTransform() })
    const original = JSON.stringify(mixed)
    expect(() => createProjectFromSceneDocument(mixed)).toThrow('同时包含二维与三维内容')
    expect(JSON.stringify(mixed)).toBe(original)
  })
  it('omits absent optional style fields without hiding invalid numeric values', () => {
    const input = snapshot()
    const base = createDefaultLayerStyle('point').symbol
    requireMapContent(input.project).layers[0].style = createCategorizedStyle('value', [{ value: 1, symbol: base, label: undefined }], base)
    requireMapContent(input.project).layers[1].style = createGraduatedStyle('value', 'equal-interval', [{ value: 2, symbol: base, label: undefined }], base)
    const document = createProjectSceneDocument(input)
    expect(parseSceneDocument(JSON.parse(JSON.stringify(document)))).toEqual(document)
    expect(document.nodes.find(node => node.id === 'a')).toMatchObject({ style: { mode: 'categorized' } })
    requireMapContent(input.project).layers[1].style = createGraduatedStyle('value', 'equal-interval', [{ value: NaN, symbol: base }], base)
    expect(() => createProjectSceneDocument(input)).toThrow()
  })
  it('retains view constraints and vector interaction when live navigation changes', () => {
    const document = createProjectSceneDocument(snapshot('map2d'))
    const view = document.views.map
    if (view.type !== '2d') throw new Error('Expected map view')
    view.extent = [-100, -100, 100, 100]; view.minZoom = 0; view.maxZoom = 18
    const node = document.nodes.find(node => node.type === 'vector')!
    if (node.type !== 'vector') throw new Error('Expected vector')
    node.minZoom = 2; node.maxZoom = 16
    node.interaction = { selectable: false, popup: { titleField: 'label', fields: [{ field: 'value', label: 'Value', format: 'number' }] } }
    const restored = parseProjectSnapshot(serializeProjectSnapshot(createProjectFromSceneDocument(document)))
    requireMapContent(restored.project).initialView = { center: [20, 30], zoom: 4, rotation: 0 }
    const exported = createProjectSceneDocument(restored)
    expect(exported.views.map).toMatchObject({ center: [20, 30], minZoom: 0, maxZoom: 18, extent: [-100, -100, 100, 100] })
    expect(exported.nodes.find(candidate => candidate.id === node.id)).toMatchObject({ minZoom: 2, maxZoom: 16, interaction: node.interaction })
  })
  it('retains description and nested JSON metadata across project serialization and scene edits', () => {
    const document = createProjectSceneDocument(snapshot('map2d'))
    document.description = ''
    document.metadata = { author: 'survey', options: { tags: ['city', null], enabled: false, revision: 0 } }
    document.widgets = { legend: false, scaleLine: true }
    document.theme = { colorScheme: 'dark', accent: '#123456' }
    document.presentation = { chapters: [{ id: 'overview', title: 'Overview', view: { projection: 'EPSG:3857', center: [0, 0], zoom: 3 }, visibleLayers: ['a'] }] }
    const restored = createProjectFromSceneDocument(document)
    const saved = parseProjectSnapshot(serializeProjectSnapshot(restored))
    saved.project.metadata.name = 'Renamed project'
    const exported = createProjectSceneDocument(saved)
    expect(exported.description).toBe('')
    expect(exported.metadata).toEqual(document.metadata)
    expect(exported.widgets).toEqual(document.widgets)
    expect(exported.theme).toEqual(document.theme)
    expect(exported.presentation).toEqual(document.presentation)
    expect(exported.title).toBe('Renamed project')
    restored.project.metadata.sceneMetadata!.author = 'changed'
    expect(document.metadata.author).toBe('survey')
    expect(exported.metadata!.author).toBe('survey')
  })

  it('maps scene selection and edit identities without introducing map content', () => {
    const input = snapshot('scene3d'), before = structuredClone(input)
    const projection = createProjectSceneProjection(input)
    expect(projection.scene3dNodeIds.get('a')).toBe('a')
    expect(projection.scene3dNodeIds.get('group')).toBe('group')
    expect(projection.hostSceneNodeIds.get('a')).toBe('a')
    expect(projection.hostSceneNodeIds.get('unknown')).toBeUndefined()
    expect(projection.hostSceneNodeIds.get('group')).toBe('group')
    expect(projection.scene3dResourceIds.get('shared')).toBe('shared')
    expect(projection.hostSceneResourceIds.get('shared')).toBe('shared')
    expect(projection.hostSceneResourceIds.get('unknown')).toBeUndefined()
    expect(projection.document.nodes.find(node => node.id === 'a')).toMatchObject({ type: '3dtiles', parentId: 'group' })
    expect(projection.document).toEqual(createProjectSceneDocument(input))
    expect(input).toEqual(before)
    const mapOnly = createProjectSceneProjection(snapshot())
    expect(mapOnly.scene3dNodeIds.size).toBe(0)
    expect(mapOnly.hostSceneNodeIds.size).toBe(0)
    expect(mapOnly.scene3dResourceIds.size).toBe(0)
    expect(mapOnly.hostSceneResourceIds.size).toBe(0)
  })
  it('retains unused scene assets and explicitly scoped empty scene groups without a 3d view', () => {
    const input = { project: createProject('Unbound assets'), featuresByDataset: {} }
    const document = createProjectSceneDocument(input)
    document.resources.orphan = { type: 'glb', url: './models/orphan.glb' }
    document.nodes.push({ type: 'group', id: 'scene3d-empty', name: 'Empty scene group', visible: false, scope: '3d' })
    const restored = createProjectFromSceneDocument(document)
    expect(restored.project.content.scene?.assets.orphan).toEqual({ type: 'glb', url: './models/orphan.glb' })
    expect(restored.project.content.scene?.groups).toContainEqual({ id: 'scene3d-empty', name: 'Empty scene group', visible: false })
    expect(restored.project.content.kind).toBe('scene3d')
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
  it('round-trips 2d content including WFS origin, auth and cached completeness', () => {
    const document = createProjectSceneDocument(snapshot())
    const restored = createProjectFromSceneDocument(JSON.stringify(document))
    expect(restored.featuresByDataset.shared).toHaveLength(3)
    expect(requireMapContent(restored.project).datasets.find(dataset => dataset.kind === 'wfs')).toMatchObject({ source: { typeName: 'roads', complete: false, truncatedByLimit: true, authMode: 'bearer', credentialRef: { key: 'service-ref' } } })
    expect(document.activeView).toBe('map')
    expect(createProjectSceneDocument(restored)).toEqual(document)
    expect(parseSceneDocument(JSON.stringify(document))).toEqual(document)
  })
  it('retains Provider credential references without embedding credential values', () => {
    const input = snapshot()
    requireMapContent(input.project).basemap = { type: 'tianditu', mapType: 'imagery', projection: 'EPSG:4326', withLabels: true, credential: 'provider-ref' }
    const document = createProjectSceneDocument(input)
    expect(document.credentials?.['provider-ref']).toEqual({ type: 'runtime-reference', key: 'provider-ref' })
    expect(requireMapContent(createProjectFromSceneDocument(document).project).basemap).toEqual(requireMapContent(input.project).basemap)
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
    requireMapContent(input.project).datasets[1].fields = [{ name: 'height', type: 'number', nullable: true }, { name: 'code', type: 'string', nullable: false }]
    const document = createProjectSceneDocument(input)
    expect(document.resources.unused.fields).toEqual(requireMapContent(input.project).datasets[1].fields)
    const restored = createProjectFromSceneDocument(document)
    expect(requireMapContent(restored.project).datasets.find(dataset => dataset.id === 'unused')?.fields).toEqual(requireMapContent(input.project).datasets[1].fields)
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
    requireMapContent(input.project).datasets.push({ id: 'wms', name: 'Service', kind: 'wms', source: { type: 'wms', url: 'https://example.test/wms', version: '1.3.0', layerNames: ['roads'], authMode: 'query-token', tokenParam: 'tk', credentialRef: { key: 'query-ref' }, crs: 'EPSG:4326', bboxWgs84: [0, 0, 1, 1] } },
      { id: 'wmts', name: 'Matrix service', kind: 'wmts', source: { type: 'wmts', url: 'https://example.test/wmts', version: '1.0.0', layer: 'terrain', authMode: 'none', tileMatrixSet: 'set', requestEncoding: 'KVP', projection: 'EPSG:3857', tileMatrices: [{ identifier: 'level-A', scaleDenominator: 100000, topLeftCorner: [0, 1000], tileWidth: 256, tileHeight: 256, matrixWidth: 8, matrixHeight: 4 }] } })
    for (const id of ['wms', 'wmts']) { requireMapContent(input.project).layers.push({ id, datasetId: id, name: id, visible: true, opacity: 1, editable: false, style: createDefaultLayerStyle() }); requireMapContent(input.project).rootOrder.push({ type: 'layer', id }) }
    const document = createProjectSceneDocument(input)
    const restored = createProjectFromSceneDocument(document)
    expect(requireMapContent(restored.project).datasets.find(dataset => dataset.id === 'wms')?.source).toEqual(requireMapContent(input.project).datasets.find(dataset => dataset.id === 'wms')?.source)
    expect(requireMapContent(restored.project).datasets.find(dataset => dataset.id === 'wmts')?.source).toEqual(requireMapContent(input.project).datasets.find(dataset => dataset.id === 'wmts')?.source)
    expect(createProjectSceneDocument(restored)).toEqual(document)
  })
})
