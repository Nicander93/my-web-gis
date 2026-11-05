import { expect, it } from 'vitest'
import { createProject, requireMapContent } from '@desktop-webgis/project'
import { createCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { prepareProjectResourceReferences, resolveProjectResourceReferences } from './project-resource-references'

it('rebases managed dataset storage for Save As while preserving original input provenance', () => {
  const project = createProject()
  requireMapContent(project).datasets = [{ id: 'data', name: 'Data', kind: 'vector', source: { type: 'geojson-file', path: 'E:/original/source.geojson' },
    storage: { type: 'managed-geojson', reference: { kind: 'relative', path: 'data/source.geojson' } } }]
  const original = { project, featuresByDataset: {} }, working = resolveProjectResourceReferences(original, 'D:/project/main.webgis.json')
  const moved = prepareProjectResourceReferences(working, 'D:/project/main.webgis.json', 'E:/copy/main.webgis.json')
  expect(requireMapContent(moved.project).datasets[0]).toMatchObject({ source: { path: 'E:/original/source.geojson' }, storage: { reference: { kind: 'absolute', path: 'D:/project/data/source.geojson' } } })
  expect(resolveProjectResourceReferences(moved, 'E:/copy/main.webgis.json')).toEqual(working)
  expect(requireMapContent(original.project).datasets[0]).toMatchObject({ storage: { reference: { kind: 'relative', path: 'data/source.geojson' } } })
})

it('keeps resource identity across opening, Save As and reopening without mutating editing state', () => {
  const project = createProject(); project.content.scene = createCesiumScene()
  project.content.scene.assets.model = { type: 'glb', reference: { kind: 'relative', path: '模型/tower.glb' } }
  project.content.scene.assets.vector = { type: 'geojson', reference: { kind: 'relative', path: '数据/points.geojson' } }
  const original = { project, featuresByDataset: {} }
  const working = resolveProjectResourceReferences(original, 'D:/project/main.webgis.json')
  const crossDrive = prepareProjectResourceReferences(working, 'D:/project/main.webgis.json', 'E:/copy/main.webgis.json')
  expect(crossDrive.project.content.scene!.assets.model.reference).toEqual({ kind: 'absolute', path: 'D:/project/模型/tower.glb' })
  expect(resolveProjectResourceReferences(crossDrive, 'E:/copy/main.webgis.json')).toEqual(working)
  const sameFolder = prepareProjectResourceReferences(working, 'E:/copy/main.webgis.json', 'D:/project/copy.webgis.json')
  expect(sameFolder.project.content.scene!.assets).toEqual(original.project.content.scene!.assets)
  expect(working.project.content.scene!.assets.vector.reference).toEqual({ kind: 'absolute', path: 'D:/project/数据/points.geojson' })
  expect(original.project.content.scene!.assets.model.reference!.kind).toBe('relative')
})

it('rejects temporary grant URLs and unanchored relative files before writing a project', () => {
  const project = createProject(); project.content.scene = createCesiumScene()
  project.content.scene.assets.model = { type: 'glb', url: 'http://webgis-resource.localhost/key/model.glb' }
  expect(() => prepareProjectResourceReferences({ project, featuresByDataset: {} }, null, 'D:/new.webgis.json')).toThrow('临时')
  project.content.scene.assets.model = { type: 'glb', reference: { kind: 'relative', path: 'model.glb' } }
  expect(() => prepareProjectResourceReferences({ project, featuresByDataset: {} }, null, 'D:/new.webgis.json')).toThrow('项目文件路径')
})
