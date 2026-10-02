import { beforeEach, describe, expect, it } from 'vitest'
import { createProject } from '@desktop-webgis/gis-core'
import { compileProjectToScene } from '@desktop-webgis/scene-core'
import { useProjectStore } from '@/stores/project.store'
import { loadCitySample,updateCity } from './city-commands'

beforeEach(() => useProjectStore.getState().loadSnapshot({project:createProject(),featuresByDataset:{}}))
describe('city workflow in the existing project store',() => {
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
