import { beforeEach, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { parseCesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { useProjectStore } from '@/stores/project.store'
import { addSceneGroup, loadSceneSample, patchSceneGroup } from './scene3d-commands'
import { compileSceneObjectExport } from './scene3d-object-export'

beforeEach(() => useProjectStore.getState().loadSnapshot({ project:createProject(), featuresByDataset:{} }))
it('exports only selected objects with their inherited state and resources, without mutating the project', () => {
  const first = loadSceneSample()
  const second = loadSceneSample()
  const group = addSceneGroup('选中对象分组', [first])
  patchSceneGroup(group, { visible:false, locked:true })
  addSceneGroup('其他分组', [second])
  const before = useProjectStore.getState().getSnapshot()
  const exported = compileSceneObjectExport(before, [first])
  const city = parseCesiumScene(JSON.parse(JSON.stringify(exported.city)))
  expect(city.nodes.map(node => node.id)).toEqual([first])
  expect(city.groups).toHaveLength(1)
  expect(city.groups?.[0]).toMatchObject({ id:group, visible:false, locked:true })
  expect(Object.keys(city.assets)).toEqual([city.nodes[0].type === '3dtiles' ? city.nodes[0].asset : ''])
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  expect(before.project.city?.nodes).toHaveLength(2)
})
it('rejects a stale selection rather than exporting unrelated objects', () => {
  loadSceneSample()
  expect(() => compileSceneObjectExport(useProjectStore.getState().getSnapshot(), ['removed'])).toThrow('请选择')
})
