import { requireMapContent } from '@desktop-webgis/project'
import { describe, expect, it } from 'vitest'
import { createDefaultLayerStyle, createProject, prepareProjectContent, parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/project'
import type { ProjectSnapshot, VectorDataset } from '@desktop-webgis/project'
import { createProjectFromSceneDocument, createProjectSceneDocument } from '@/io/project-scene-document'
import { assignSourceCrs } from './source-crs'
import { compileProjectToScene } from '@/io/compile-project'

function fixture(): { snapshot: ProjectSnapshot; dataset: VectorDataset } {
  const dataset: VectorDataset = { id: 'data', name: 'Points', kind: 'vector', source: { type: 'memory', label: 'Points' } }
  const project = createProject('CRS')
  requireMapContent(project).datasets = [dataset]
  requireMapContent(project).layers = ['a', 'b'].map(id => ({ id, name: id, datasetId: dataset.id, editable: true, visible: true, opacity: 1, style: createDefaultLayerStyle('point') }))
  requireMapContent(project).rootOrder = requireMapContent(project).layers.map(layer => ({ type: 'layer', id: layer.id }))
  const normalized = prepareProjectContent(project)
  const normalizedDataset = requireMapContent(normalized).datasets[0]
  if (normalizedDataset.kind !== 'vector') throw new Error('Expected vector fixture')
  return { dataset: normalizedDataset, snapshot: { project: normalized, featuresByDataset: { data: [{ id: 'point', geometry: { type: 'Point', coordinates: [116, 39, 12] }, properties: { code: '001' }, metadata: { sourceCrs: 'EPSG:4326' } }] } } }
}

describe('source CRS assignment', () => {
  it('refuses a shared source declaration when any layer has a local lock', () => {
    const { snapshot, dataset } = fixture()
    requireMapContent(snapshot.project).layers[1].locked = true
    expect(() => assignSourceCrs(snapshot, dataset, 'EPSG:3857')).toThrow('锁定')
  })

  it('changes only dataset metadata, retaining shared layers, coordinates and original provenance', () => {
    const { snapshot, dataset } = fixture(), before = structuredClone(snapshot)
    const after = assignSourceCrs(snapshot, dataset, 'EPSG:3857')
    expect(snapshot).toEqual(before)
    expect(after.featuresByDataset).toEqual(before.featuresByDataset)
    expect(requireMapContent(after.project).layers).toEqual(requireMapContent(before.project).layers)
    expect(requireMapContent(after.project).datasets).toEqual([{ ...dataset, sourceCrs: 'EPSG:3857' }])
    expect(parseProjectSnapshot(serializeProjectSnapshot(after))).toEqual(after)
    expect(compileProjectToScene(after).scene.metadata).toMatchObject({ layerMeta: { a: { sourceCrs: 'EPSG:3857' }, b: { sourceCrs: 'EPSG:3857' } } })
  })
  it('preserves the declaration in portable scenes separately from the coordinate CRS', () => {
    const { snapshot, dataset } = fixture()
    const doc = createProjectSceneDocument(assignSourceCrs(snapshot, dataset, 'EPSG:4490'))
    expect(doc.resources.data).toMatchObject({ sourceCrs: 'EPSG:4490', dataProjection: 'EPSG:4326' })
    const restored = createProjectFromSceneDocument(JSON.stringify(doc))
    expect(requireMapContent(restored.project).datasets.find(item => item.id === 'data')).toMatchObject({ sourceCrs: 'EPSG:4490' })
    expect(restored.featuresByDataset.data).toEqual(snapshot.featuresByDataset.data)
    doc.resources.data.sourceCrs = ''
    expect(() => createProjectFromSceneDocument(doc)).toThrow()
  })
  it('rejects stale or deleted dataset targets', () => {
    const { snapshot, dataset } = fixture(), base = structuredClone(dataset)
    dataset.name = 'external'
    expect(() => assignSourceCrs(snapshot, base, 'EPSG:4326')).toThrow('重新载入')
    requireMapContent(snapshot.project).datasets = []
    expect(() => assignSourceCrs(snapshot, base, 'EPSG:4326')).toThrow('重新载入')
  })
  it('respects locked folders of other layers sharing the dataset', () => {
    const { snapshot, dataset } = fixture()
    requireMapContent(snapshot.project).groups = [{ id: 'locked', name: 'Locked', visible: true, locked: true, layerIds: ['b'] }]
    expect(() => assignSourceCrs(snapshot, dataset, 'EPSG:4326')).toThrow('锁定')
  })
  it('rejects unknown and empty definitions without mutation', () => {
    const { snapshot, dataset } = fixture(), before = structuredClone(snapshot)
    expect(() => assignSourceCrs(snapshot, dataset, '')).toThrow()
    expect(() => assignSourceCrs(snapshot, dataset, 'EPSG:UNKNOWN')).toThrow()
    expect(snapshot).toEqual(before)
  })
})
