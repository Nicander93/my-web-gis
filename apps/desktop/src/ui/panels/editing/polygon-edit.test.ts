import { projectSession } from '@/project/project-session'
import { projectEdits } from '@/project/project-edits'
import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { beforeEach, describe, expect, it } from 'vitest'
import { createProject, createDefaultLayerStyle, type GisFeature } from '@desktop-webgis/project'
import { mergePolygonGeometries, splitPolygonGeometry } from '@desktop-webgis/spatial-analysis'
import { useProjectStore } from '@/project/project.store'
import { preparePolygonEdit } from './polygon-edit'

const square = (id: string, x: number, value: number): GisFeature => ({ id, properties: { value, name: id },
  geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]]] },
  metadata: { sceneFeatureId: id, sceneMetadataPresent: true, sourceId: id } })

describe('in-place polygon edit transactions', () => {
  beforeEach(() => {
    const project = createProject('Topology')
    requireMapContent(project).datasets = [{ id: 'data', name: 'Areas', kind: 'vector', source: { type: 'memory', label: 'Areas' } }]
    requireMapContent(project).layers = [{ id: 'layer', datasetId: 'data', name: 'Areas', visible: true, opacity: 1, editable: true, style: createDefaultLayerStyle('polygon') }]
    projectSession.loadSnapshot({ project, featuresByDataset: { data: [square('a', 0, 2), square('b', 10, 4), square('c', 30, 8)] } })
  })
  it('merges selected features using numeric sums and one undo while retaining the chosen ID and untouched rows', () => {
    const before = projectSession.getSnapshot()
    const prepared = preparePolygonEdit(before, 'layer', ['a', 'b'], { mode: 'merge', primaryId: 'b', policy: 'sum' })
    const result = prepared.finish({ mode: 'merge', geometry: mergePolygonGeometries(prepared.input.features.map((feature) => feature.geometry)) })
    projectEdits.execute(result.command)
    const after = featureData.readSnapshot().data
    expect(after.map((feature) => feature.id)).toEqual(['b', 'c'])
    expect(after[0].properties).toEqual({ value: 6, name: 'b' })
    expect(after[0].metadata).toEqual(before.featuresByDataset.data[1].metadata)
    expect(after[1]).toEqual(before.featuresByDataset.data[2])
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.canUndo()).toBe(false)
    expect(projectEdits.redo()).toBe(true)
    expect(featureData.readSnapshot().data[0].geometry.type).toBe('Polygon')
  })
  it('rejects null conflict strategy for required fields before computing or touching data', () => {
    const before = projectSession.getSnapshot()
    requireMapContent(before.project).datasets[0].fields = [{ name: 'value', type: 'number', nullable: false }]
    expect(() => preparePolygonEdit(before, 'layer', ['a', 'b'], { mode: 'merge', primaryId: 'a', policy: 'null-conflicts' })).toThrow(/不允许空值/)
    expect(projectEdits.canUndo()).toBe(false)
  })
  it('splits one area, clones properties, gives fragments unique public IDs and undoes the whole edit once', () => {
    const before = projectSession.getSnapshot()
    const cutter = { type: 'LineString' as const, coordinates: [[5, -1], [5, 11]] }
    const prepared = preparePolygonEdit(before, 'layer', ['a'], { mode: 'split', cutter })
    const result = prepared.finish({ mode: 'split', parts: { a: splitPolygonGeometry(prepared.input.features[0].geometry, cutter) } })
    projectEdits.execute(result.command)
    const after = featureData.readSnapshot().data
    expect(after).toHaveLength(4)
    expect(after[0].id).toBe('a')
    expect(after[1].id).not.toBe('a')
    expect(after[1].metadata?.sceneFeatureId).toBeUndefined()
    expect(after[1].properties).toEqual(before.featuresByDataset.data[0].properties)
    expect(after.slice(2)).toEqual(before.featuresByDataset.data.slice(1))
    expect(projectEdits.undo()).toBe(true)
    expect(projectSession.getSnapshot()).toEqual(before)
  })
  it('does not create a history step for a cutter that never forms new faces', () => {
    const before = projectSession.getSnapshot()
    const prepared = preparePolygonEdit(before, 'layer', ['a'], { mode: 'split', cutter: { type: 'LineString', coordinates: [[-1, 5], [5, 5]] } })
    expect(() => prepared.finish({ mode: 'split', parts: { a: null } })).toThrow(/未形成新面/)
    expect(projectSession.getSnapshot()).toEqual(before)
    expect(projectEdits.canUndo()).toBe(false)
  })

  it('respects inherited locks on any layer sharing the dataset before topology edits', () => {
    const before = projectSession.getSnapshot()
    requireMapContent(before.project).layers.push({ ...requireMapContent(before.project).layers[0], id: 'shared', name: 'Shared' })
    requireMapContent(before.project).groups = [{ id: 'folder', name: 'Locked folder', visible: true, layerIds: ['shared'], locked: true }]
    expect(() => preparePolygonEdit(before, 'layer', ['a', 'b'], { mode: 'merge', primaryId: 'a', policy: 'primary' })).toThrow(/Shared.*已锁定/)
    expect(projectEdits.canUndo()).toBe(false)
  })

  it('compares JSON conflict values structurally and preserves nullable types', () => {
    const before = projectSession.getSnapshot()
    requireMapContent(before.project).datasets[0].fields = [{ name: 'value', type: 'number', nullable: true },
      { name: 'name', type: 'string', nullable: true }, { name: 'settings', type: 'json', nullable: true }]
    before.featuresByDataset.data[0].properties.settings = { x: 1, y: 2 }
    before.featuresByDataset.data[1].properties.settings = { y: 2, x: 1 }
    const prepared = preparePolygonEdit(before, 'layer', ['a', 'b'], { mode: 'merge', primaryId: 'a', policy: 'null-conflicts' })
    const result = prepared.finish({ mode: 'merge', geometry: mergePolygonGeometries(prepared.input.features.map((feature) => feature.geometry)) })
    projectEdits.execute(result.command)
    expect(featureData.readSnapshot().data[0].properties).toEqual({ value: null, name: null, settings: { x: 1, y: 2 } })
  })
})
