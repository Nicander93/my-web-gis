import { expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { createCityScene } from '@desktop-webgis/cesium-scene-schema'
import { prepareProjectResourceReferences, resolveProjectResourceReferences } from './project-resource-references'

it('keeps resource identity across opening, Save As and reopening without mutating editing state', () => {
  const project = createProject(); project.city = createCityScene()
  project.city.assets.model = { type: 'glb', reference: { kind: 'relative', path: '模型/tower.glb' } }
  project.city.assets.vector = { type: 'geojson', reference: { kind: 'relative', path: '数据/points.geojson' } }
  const original = { project, featuresByDataset: {} }
  const working = resolveProjectResourceReferences(original, 'D:/project/main.webgis.json')
  const crossDrive = prepareProjectResourceReferences(working, 'D:/project/main.webgis.json', 'E:/copy/main.webgis.json')
  expect(crossDrive.project.city!.assets.model.reference).toEqual({ kind: 'absolute', path: 'D:/project/模型/tower.glb' })
  expect(resolveProjectResourceReferences(crossDrive, 'E:/copy/main.webgis.json')).toEqual(working)
  const sameFolder = prepareProjectResourceReferences(working, 'E:/copy/main.webgis.json', 'D:/project/copy.webgis.json')
  expect(sameFolder.project.city!.assets).toEqual(original.project.city!.assets)
  expect(working.project.city!.assets.vector.reference).toEqual({ kind: 'absolute', path: 'D:/project/数据/points.geojson' })
  expect(original.project.city!.assets.model.reference!.kind).toBe('relative')
})

it('rejects temporary grant URLs and unanchored relative files before writing a project', () => {
  const project = createProject(); project.city = createCityScene()
  project.city.assets.model = { type: 'glb', url: 'http://webgis-resource.localhost/key/model.glb' }
  expect(() => prepareProjectResourceReferences({ project, featuresByDataset: {} }, null, 'D:/new.webgis.json')).toThrow('临时')
  project.city.assets.model = { type: 'glb', reference: { kind: 'relative', path: 'model.glb' } }
  expect(() => prepareProjectResourceReferences({ project, featuresByDataset: {} }, null, 'D:/new.webgis.json')).toThrow('项目文件路径')
})
