import { describe, expect, it } from 'vitest'
import { createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { SetCesiumSceneCommand } from './scene3dCommands'
import { createProject, parseProjectSnapshot, serializeProjectSnapshot } from '../config/project'
import { EditHistory } from './editHistory'
import { MemoryFeatureStore } from '../data/featureStore'

describe('scene project persistence and history', () => {
  it('shares history and restores absence on undo for a legacy project', () => {
    let project = createProject('Scene', 'scene3d'), scene = createCesiumScene()
    const history = new EditHistory(), context = { featureStore:new MemoryFeatureStore(), getProject:() => project, replaceProject:(next:typeof project) => { project = next } }
    const originalContent = project.content
    history.execute(new SetCesiumSceneCommand('add','Add scene',undefined,scene),context)
    expect(originalContent.scene).toEqual(createCesiumScene())
    expect(project.content.scene).toEqual(scene)
    history.undo(context); expect(project.content.scene).toEqual(createCesiumScene())
    history.redo(context); expect(project.content.scene).toEqual(scene)
  })
  it('roundtrips model transforms and rejects invalid scene state on open', () => {
    const project = createProject('Scene', 'scene3d'), scene = createCesiumScene()
    scene.assets.tileset = { type:'3dtiles',url:'./tileset.json' }
    scene.nodes.push({ id:'tileset',name:'Scene',type:'3dtiles',visible:true,asset:'tileset',transform:{ ...createTransform(),translation:[10,20,30] } })
    project.content.scene = scene
    const snapshot = { project,featuresByDataset:{} }
    expect(parseProjectSnapshot(serializeProjectSnapshot(snapshot)).project.content.scene).toEqual(scene)
    scene.nodes[0].id = ''
    expect(() => parseProjectSnapshot(serializeProjectSnapshot(snapshot))).toThrow('ID')
  })
})
