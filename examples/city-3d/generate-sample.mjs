// Deterministic original geometry: no remote assets, account, or provider token.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'city-sample')
fs.mkdirSync(directory, { recursive: true })

const faces = [
  [[1,0,0], [[.5,0,-.5],[.5,0,.5],[.5,1,.5],[.5,1,-.5]]],
  [[-1,0,0], [[-.5,0,.5],[-.5,0,-.5],[-.5,1,-.5],[-.5,1,.5]]],
  [[0,1,0], [[-.5,1,-.5],[.5,1,-.5],[.5,1,.5],[-.5,1,.5]]],
  [[0,-1,0], [[-.5,0,.5],[.5,0,.5],[.5,0,-.5],[-.5,0,-.5]]],
  [[0,0,1], [[.5,0,.5],[-.5,0,.5],[-.5,1,.5],[.5,1,.5]]],
  [[0,0,-1], [[-.5,0,-.5],[.5,0,-.5],[.5,1,-.5],[-.5,1,-.5]]]
]
const positions = new Float32Array(faces.flatMap(([,points]) => points.flat()))
const normals = new Float32Array(faces.flatMap(([normal]) => Array(4).fill(normal).flat()))
const indices = new Uint16Array(faces.flatMap((_,i) => [0,1,2,0,2,3].map(n => n+i*4)))
const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(normals.buffer), Buffer.from(indices.buffer)])

function writeModel(name, nodes) {
  const gltf = {
    asset: { version: '2.0', generator: 'Desktop WebGIS original city fixture' },
    scene: 0, scenes: [{ nodes: nodes.map((_,i) => i) }], nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [.48,.65,.76,1], metallicFactor: .1, roughnessFactor: .6 }, doubleSided: true }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer:0, byteOffset:0, byteLength:positions.byteLength, target:34962 }, { buffer:0, byteOffset:positions.byteLength, byteLength:normals.byteLength, target:34962 }, { buffer:0, byteOffset:positions.byteLength+normals.byteLength, byteLength:indices.byteLength, target:34963 }],
    accessors: [{ bufferView:0, componentType:5126, count:24, type:'VEC3', min:[-.5,0,-.5], max:[.5,1,.5] }, { bufferView:1, componentType:5126, count:24, type:'VEC3' }, { bufferView:2, componentType:5123, count:36, type:'SCALAR' }]
  }
  const json = Buffer.from(JSON.stringify(gltf)), padding = Buffer.alloc((4-json.length%4)%4, 32)
  const jsonChunk = Buffer.concat([json,padding])
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jsonChunk.length+binary.length,8)
  header.writeUInt32LE(jsonChunk.length,12);header.writeUInt32LE(0x4e4f534a,16)
  const binHeader = Buffer.alloc(8);binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4)
  fs.writeFileSync(path.join(directory,name),Buffer.concat([header,jsonChunk,binHeader,binary]))
}
const nodes = []
for(let row=0;row<4;row++) for(let col=0;col<4;col++) nodes.push({name:`Building ${row*4+col+1}`,mesh:0,translation:[(col-1.5)*85,0,(row-1.5)*85],scale:[42,35+((row*7+col*11)%6)*18,42]})
nodes.push({name:'City platform',mesh:0,translation:[0,-3,0],scale:[430,3,430]})
writeModel('city.glb',nodes)
writeModel('tower.glb',[{name:'Tower',mesh:0,scale:[35,95,35]}])
const lon=116.391*Math.PI/180,lat=39.907*Math.PI/180, n=6378137/Math.sqrt(1-.00669437999014*Math.sin(lat)**2)
const transform=[-Math.sin(lon),Math.cos(lon),0,0,-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat),0,Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat),0,n*Math.cos(lat)*Math.cos(lon),n*Math.cos(lat)*Math.sin(lon),n*(1-.00669437999014)*Math.sin(lat),1]
fs.writeFileSync(path.join(directory,'tileset.json'),JSON.stringify({asset:{version:'1.1'},geometricError:1000,root:{boundingVolume:{box:[0,0,65,230,0,0,0,230,0,0,0,70]},geometricError:0,refine:'ADD',transform,content:{uri:'city.glb'}}},null,2)+'\n')
