import { describe, expect, it } from 'vitest'
import { createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { SetCesiumSceneCommand } from './scene3dCommands'
import { createProject, parseProjectSnapshot, serializeProjectSnapshot } from './project'
import { EditHistory } from './editHistory'
import { MemoryFeatureStore } from './featureStore'

describe('city project persistence and history', () => {
  it('shares history and restores absence on undo for a legacy project', () => {
    let project = createProject(), city = createCesiumScene()
    const history = new EditHistory(), context = { featureStore:new MemoryFeatureStore(), getProject:() => project, replaceProject:(next:typeof project) => { project = next } }
    history.execute(new SetCesiumSceneCommand('add','Add city',undefined,city),context)
    expect(project.city).toEqual(city)
    history.undo(context); expect(project.city).toBeUndefined()
    history.redo(context); expect(project.city).toEqual(city)
  })
  it('roundtrips model transforms and rejects invalid city state on open', () => {
    const project = createProject(), city = createCesiumScene()
    city.assets.city = { type:'3dtiles',url:'./tileset.json' }
    city.nodes.push({ id:'city',name:'City',type:'3dtiles',visible:true,asset:'city',transform:{ ...createTransform(),translation:[10,20,30] } })
    project.city = city
    const snapshot = { project,featuresByDataset:{} }
    expect(parseProjectSnapshot(serializeProjectSnapshot(snapshot)).project.city).toEqual(city)
    city.nodes[0].id = ''
    expect(() => parseProjectSnapshot(serializeProjectSnapshot(snapshot))).toThrow('ID')
  })
})
