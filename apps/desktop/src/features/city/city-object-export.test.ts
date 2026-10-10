import { beforeEach, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { parseCityScene } from '@desktop-webgis/cesium-scene-schema'
import { useProjectStore } from '@/stores/project.store'
import { addCityGroup, loadCitySample, patchCityGroup } from './city-commands'
import { compileCityObjectExport } from './city-object-export'

beforeEach(() => useProjectStore.getState().loadSnapshot({ project:createProject(), featuresByDataset:{} }))
it('exports only selected objects with their inherited state and resources, without mutating the project', () => {
  const first = loadCitySample()
  const second = loadCitySample()
  const group = addCityGroup('选中对象分组', [first])
  patchCityGroup(group, { visible:false, locked:true })
  addCityGroup('其他分组', [second])
  const before = useProjectStore.getState().getSnapshot()
  const exported = compileCityObjectExport(before, [first])
  const city = parseCityScene(JSON.parse(JSON.stringify(exported.city)))
  expect(city.nodes.map(node => node.id)).toEqual([first])
  expect(city.groups).toHaveLength(1)
  expect(city.groups?.[0]).toMatchObject({ id:group, visible:false, locked:true })
  expect(Object.keys(city.assets)).toEqual([city.nodes[0].type === '3dtiles' ? city.nodes[0].asset : ''])
  expect(useProjectStore.getState().getSnapshot()).toEqual(before)
  expect(before.project.city?.nodes).toHaveLength(2)
})
it('rejects a stale selection rather than exporting unrelated objects', () => {
  loadCitySample()
  expect(() => compileCityObjectExport(useProjectStore.getState().getSnapshot(), ['removed'])).toThrow('请选择')
})
