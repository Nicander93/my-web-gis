import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createCityScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import { buildStaticScene } from './publisher'

const temporary:string[]=[]
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir,{recursive:true,force:true}))) })
async function setup() {
  const root=await mkdtemp(path.join(os.tmpdir(),'city-publish-'));temporary.push(root)
  const viewer=path.join(root,'viewer'),data=path.join(root,'data')
  await mkdir(viewer);await mkdir(data);await writeFile(path.join(viewer,'index.html'),'<main>City Viewer</main>')
  const city=createCityScene();city.assets.city={type:'3dtiles',url:'./models/tileset.json'}
  city.nodes.push({id:'city',name:'City',visible:true,type:'3dtiles',asset:'city',transform:createTransform()})
  const scene={version:2,id:'city',title:'City',view:{projection:'EPSG:3857',center:[0,0],zoom:2},sources:{},layers:[],city}
  return {root,viewer,data,scene,output:path.join(root,'published')}
}
describe('city publication dependency collection',() => {
  it('rejects local environment services instead of publishing incomplete terrain', async () => {
    const s = await setup(); s.scene.city.terrain = { url: './terrain' }
    await expect(buildStaticScene({ scene:s.scene, viewerDirectory:s.viewer, outputDirectory:s.output })).rejects.toThrow('三维底图和地形')
  })
  it('rejects model paths that overwrite the viewer application', async () => {
    const s = await setup(); s.scene.city.assets.city.url = './index.html'
    const model = path.join(s.data,'model.bin'); await writeFile(model,'model')
    await expect(buildStaticScene({ scene:s.scene, viewerDirectory:s.viewer, outputDirectory:s.output, resources:{ './index.html':model } })).rejects.toThrow('Viewer 文件冲突')
  })
  it('collects nested tilesets and glTF texture/buffer files',async () => {
    const s=await setup();await mkdir(path.join(s.data,'child'));await mkdir(path.join(s.data,'textures'))
    await writeFile(path.join(s.data,'tileset.json'),JSON.stringify({root:{children:[{content:{uri:'child/tileset.json'}}]}}))
    await writeFile(path.join(s.data,'child','tileset.json'),JSON.stringify({root:{content:{uri:'model.gltf'}}}))
    await writeFile(path.join(s.data,'child','model.gltf'),JSON.stringify({asset:{version:'2.0'},buffers:[{uri:'mesh.bin'}],images:[{uri:'../textures/wall.png'}]}))
    await writeFile(path.join(s.data,'child','mesh.bin'),'binary');await writeFile(path.join(s.data,'textures','wall.png'),'texture')
    const result=await buildStaticScene({scene:s.scene,viewerDirectory:s.viewer,outputDirectory:s.output,resources:{'./models/tileset.json':path.join(s.data,'tileset.json')}})
    expect(result.manifest.files.map(f => f.path)).toContain('models/textures/wall.png')
    expect(await readFile(path.join(s.output,'models','child','mesh.bin'),'utf8')).toBe('binary')
    expect(JSON.parse(await readFile(path.join(s.output,'scene.json'),'utf8')).city).toEqual(s.scene.city)
  })
  it('fails before writing when a model dependency escapes the declared asset directory',async () => {
    const s=await setup();await writeFile(path.join(s.root,'secret.bin'),'private')
    await writeFile(path.join(s.data,'tileset.json'),JSON.stringify({root:{content:{uri:'../secret.bin'}}}))
    await expect(buildStaticScene({scene:s.scene,viewerDirectory:s.viewer,outputDirectory:s.output,resources:{'./models/tileset.json':path.join(s.data,'tileset.json')}})).rejects.toThrow('越出')
  })
  it('fails for missing nested content rather than emitting a broken viewer',async () => {
    const s=await setup();await writeFile(path.join(s.data,'tileset.json'),JSON.stringify({root:{content:{uri:'missing.glb'}}}))
    await expect(buildStaticScene({scene:s.scene,viewerDirectory:s.viewer,outputDirectory:s.output,resources:{'./models/tileset.json':path.join(s.data,'tileset.json')}})).rejects.toThrow('模型依赖')
  })
})
