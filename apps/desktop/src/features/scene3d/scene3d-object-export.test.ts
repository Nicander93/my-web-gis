import { projectSession } from '@/session/project-session'
import { beforeEach, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/project'
import { parseCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { useProjectStore } from '@/session/project.store'
import { addSceneGroup, loadSceneSample, patchSceneGroup } from './scene3d-commands'
import { compileSceneObjectExport } from './scene3d-object-export'

beforeEach(() => projectSession.loadSnapshot({ project:createProject('Scene', 'scene3d'), featuresByDataset:{} }))
it('exports only selected objects with their inherited state and resources, without mutating the project', () => {
  const first = loadSceneSample()
  const second = loadSceneSample()
  const group = addSceneGroup('选中对象分组', [first])
  patchSceneGroup(group, { visible:false, locked:true })
  addSceneGroup('其他分组', [second])
  const before = projectSession.getSnapshot()
  const exported = compileSceneObjectExport(before, [first])
  const exportedScene = parseCesiumScene(JSON.parse(JSON.stringify(exported.city)))
  expect(exportedScene.nodes.map(node => node.id)).toEqual([first])
  expect(exportedScene.groups).toHaveLength(1)
  expect(exportedScene.groups?.[0]).toMatchObject({ id:group, visible:false, locked:true })
  expect(Object.keys(exportedScene.assets)).toEqual([exportedScene.nodes[0].type === '3dtiles' ? exportedScene.nodes[0].asset : ''])
  expect(projectSession.getSnapshot()).toEqual(before)
  expect(before.project.content.scene?.nodes).toHaveLength(2)
})
it('rejects a stale selection rather than exporting unrelated objects', () => {
  loadSceneSample()
  expect(() => compileSceneObjectExport(projectSession.getSnapshot(), ['removed'])).toThrow('请选择')
})
