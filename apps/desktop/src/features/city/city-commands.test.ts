import { beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { parseProjectSnapshot, serializeProjectSnapshot } from '@desktop-webgis/gis-core'
import { useCityLayoutStore } from './city-layout.store'
import { compileProjectToScene } from '@desktop-webgis/scene-core'
import { useProjectStore } from '@/stores/project.store'
import { loadCitySample,updateCity } from './city-commands'

beforeEach(() => useProjectStore.getState().loadSnapshot({project:createProject(),featuresByDataset:{}}))
describe('city workflow in the existing project store',() => {
  it('commits one graphic, persists style and popup, and keeps ribbon preferences outside history',() => {
    const store = useProjectStore.getState()
    updateCity('绘制面', city => { city.nodes.push({ id: 'area', name: 'Area', type: 'graphic', visible: true, geometry: { type: 'polygon', heightMode: 'ground', positions: [[116,39,0],[116.1,39,0],[116,39.1,0]] }, style: { color: '#336699', width: 3, pointSize: 10, label: 'Zone' }, properties: { name: 'Area' }, popup: { fields: [{ field: 'name', label: '名称' }] } }); return city })
    const snapshot = store.getSnapshot()
    expect(parseProjectSnapshot(serializeProjectSnapshot(snapshot)).project.city).toEqual(snapshot.project.city)
    const layout = useCityLayoutStore.getState(); layout.setCategory('edit'); layout.toggleExpanded()
    expect(store.getSnapshot()).toEqual(snapshot)
    expect(store.undoEdit()).toBe(true)
    expect(useProjectStore.getState().project.city).toBeUndefined()
    expect(store.undoEdit()).toBe(false)
    expect(store.redoEdit()).toBe(true)
    expect(useProjectStore.getState().project.city?.nodes).toHaveLength(1)
  })
  it('adds a city, commits one drag, and undoes in the shared history',() => {
    const id=loadCitySample(),store=useProjectStore.getState()
    updateCity('变换三维模型',scene => ({...scene,nodes:scene.nodes.map(n => n.id === id && n.type === '3dtiles' ? {...n,transform:{...n.transform,translation:[30,20,0]}} : n)}))
    const scene=compileProjectToScene(useProjectStore.getState().getSnapshot()).scene
    const node=scene.city?.nodes[0]
    expect(node?.type === '3dtiles' && node.transform.translation).toEqual([30,20,0])
    store.undoEdit()
    const original=useProjectStore.getState().project.city?.nodes[0]
    expect(original?.type === '3dtiles' && original.transform.translation).toEqual([0,0,0])
    store.undoEdit();expect(useProjectStore.getState().project.city).toBeUndefined()
    store.redoEdit();expect(useProjectStore.getState().project.city?.nodes).toHaveLength(1)
  })
})
