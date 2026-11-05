import { describe, expect, it } from 'vitest'
import { createProject, createDefaultLayerStyle } from './project'
import { requireMapContent } from './project-content'
import { parseProjectFileSnapshot, serializeProjectFile } from './project-format'

function fixture() {
  const project = createProject('Storage'), content = requireMapContent(project)
  content.datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'shapefile-file', path: 'D:/origin/shape.shp' },
    storage: { type: 'managed-geojson', reference: { kind: 'relative', path: 'data/source.geojson' } } }]
  content.layers = [{ id: 'layer', datasetId: 'data', name: 'Data', visible: true, editable: true, opacity: 1, style: createDefaultLayerStyle('point') }]
  return { project, featuresByDataset: {} }
}
describe('managed dataset storage definition', () => {
  it('persists a data reference independently from original source provenance and embedded rows', () => {
    const parsed = parseProjectFileSnapshot(serializeProjectFile(fixture()))
    expect(requireMapContent(parsed.project).datasets[0]).toMatchObject({ source: { type: 'shapefile-file', path: 'D:/origin/shape.shp' },
      storage: { type: 'managed-geojson', reference: { kind: 'relative', path: 'data/source.geojson' } } })
    expect(parsed.featuresByDataset).toEqual({})
  })
  it('rejects URL, malformed and wrong-kind storage at the persistence boundary', () => {
    const snapshot = fixture(), dataset = requireMapContent(snapshot.project).datasets[0]
    for (const storage of [
      { type: 'managed-geojson', reference: { kind: 'url', url: 'https://example.test/data.geojson' } },
      { type: 'other', reference: { kind: 'absolute', path: 'D:/data.geojson' } },
      { type: 'managed-geojson', reference: { kind: 'relative', path: 'D:/data.geojson' } }
    ]) {
      Object.assign(dataset, { storage })
      expect(() => serializeProjectFile(snapshot)).toThrow('保存目标引用无效')
    }
    Object.assign(dataset, { kind: 'wfs', source: { type: 'wfs', url: 'https://example.test/wfs', typeName: 'data', version: '2.0.0', authMode: 'none' },
      storage: { type: 'managed-geojson', reference: { kind: 'absolute', path: 'D:/data.geojson' } } })
    expect(() => serializeProjectFile(snapshot)).toThrow('保存目标引用无效')
  })
})
