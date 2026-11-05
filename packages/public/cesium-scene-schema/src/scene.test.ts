import { describe, expect, it } from 'vitest'
import { createCesiumScene, createTransform, isSceneResourceUrl, parseCesiumScene, TILESET_PARAMETER_DESCRIPTORS, validateCesiumScene } from './index'

describe('3D scene contract', () => {
  it('accepts a detached 3D scene with a georeferenced tileset', () => {
    const scene = createCesiumScene()
    scene.assets.city = { type: '3dtiles', url: './city/tileset.json' }
    scene.nodes.push({ id: 'city', name: 'City', visible: true, type: '3dtiles', asset: 'city', transform: createTransform() })
    const result = parseCesiumScene(JSON.stringify(scene))
    expect(result).toEqual(scene)
    result.nodes[0].name = 'Changed'
    expect(scene.nodes[0].name).toBe('City')
  })
  it('preserves native tileset style JSON and validates only its JSON contract', () => {
    const scene = createCesiumScene(); scene.assets.city = { type: '3dtiles', url: './city/tileset.json' }
    const style = { color: 'color("red")', customExpression: { future: [1, true, null] } }
    scene.nodes.push({ id: 'city', name: 'City', visible: true, type: '3dtiles', asset: 'city', transform: createTransform(), style, maximumScreenSpaceError: 0, cacheBytes: 0, dynamicScreenSpaceErrorDensity: 0 })
    expect(parseCesiumScene(JSON.stringify(scene)).nodes[0]).toMatchObject({ style, maximumScreenSpaceError: 0, cacheBytes: 0 })
    const invalid = structuredClone(scene) as typeof scene
    if (invalid.nodes[0].type === '3dtiles') invalid.nodes[0].style = { bad: undefined }
    expect(validateCesiumScene(invalid).some(issue => issue.path === '$.nodes[0].style')).toBe(true)
  })
  it('publishes the explicit initial Tileset parameter coverage contract', () => {
    expect(new Set(TILESET_PARAMETER_DESCRIPTORS.map(item => item.lifecycle))).toEqual(new Set(['runtime', 'recreate', 'readonly', 'action']))
    expect(TILESET_PARAMETER_DESCRIPTORS.filter(item => item.lifecycle === 'runtime' && item.kind !== 'json').every(item => item.validate(item.defaultValue))).toBe(true)
    expect(TILESET_PARAMETER_DESCRIPTORS.find(item => item.apiName === 'url')?.validate('javascript:alert(1)')).toBe(false)
  })
  it('reports duplicate IDs, mismatched assets and invalid transforms', () => {
    const scene = createCesiumScene()
    scene.assets.city = { type: 'glb', url: './scene3d.glb' }
    const node = { id: 'city', name: 'City', visible: true, type: '3dtiles' as const, asset: 'city', transform: { ...createTransform(), scale: 0 } }
    scene.nodes = [node,structuredClone(node)]
    const paths = validateCesiumScene(scene).map(issue => issue.path)
    expect(paths).toContain('$.nodes[0].asset')
    expect(paths).toContain('$.nodes[0].transform')
    expect(paths).toContain('$.nodes[1].id')
  })
  it('rejects invalid water coordinates and parameters', () => {
    const scene = createCesiumScene()
    scene.nodes.push({ id:'water',name:'Water',visible:true,type:'water',boundary:[[0,0,0],[0,0,0],[181,0,0]],height:0,color:'#abcdef',amplitude:-1,frequency:100,speed:.02 })
    expect(() => parseCesiumScene(scene)).toThrow('boundary')
  })
  it.each(['file:///c:/secret.glb','../secret.glb','/absolute.glb','javascript:alert(1)','https://user:pass@host/model.glb','https://host/tileset.json?token=secret'])('rejects unsafe or credential-bearing URL %s', url => {
    expect(isSceneResourceUrl(url)).toBe(false)
  })
  it('accepts imagery URL templates and normal service parameters', () => {
    expect(isSceneResourceUrl('https://host/{z}/{x}/{y}.png?style=night')).toBe(true)
  })
  it('validates persistent clipping polygons on 3D Tiles nodes', () => {
    const scene = createCesiumScene()
    scene.assets.tiles = { type: '3dtiles', url: './tiles/tileset.json' }
    scene.nodes.push({
      id: 'tiles', name: 'Tiles', visible: true, type: '3dtiles', asset: 'tiles', transform: createTransform(),
      effects: [{ id: 'clip-1', kind: 'clip-polygon', enabled: true, mode: 'keep-inside', positions: [[116.39,39.9,0],[116.4,39.9,0],[116.4,39.91,0]] }]
    })
    expect(validateCesiumScene(scene)).toEqual([])
    scene.nodes[0].effects?.push({ ...scene.nodes[0].effects[0], positions: [[0,0,0],[0,0,1],[0,0,2]] })
    const paths = validateCesiumScene(scene).map(issue => issue.path)
    expect(paths).toContain('$.nodes[0].effects[1].id')
    expect(paths).toContain('$.nodes[0].effects[1].positions')
  })
  it('accepts a configurable flatten height and rejects non-finite values', () => {
    const scene = createCesiumScene(); scene.assets.tiles = { type: '3dtiles', url: './tiles/tileset.json' }
    scene.nodes.push({ id: 'tiles', name: 'Tiles', visible: true, type: '3dtiles', asset: 'tiles', transform: createTransform(), effects: [
      { id: 'flat', kind: 'flatten-polygon', enabled: true, height: 32.5, positions: [[116.39,39.9,0],[116.4,39.9,0],[116.4,39.91,0]] }
    ] })
    expect(validateCesiumScene(scene)).toEqual([])
    scene.nodes[0].effects![0] = { ...scene.nodes[0].effects![0], height: Number.NaN } as never
    expect(validateCesiumScene(scene).map(issue => issue.path)).toContain('$.nodes[0].effects[0].height')
  })
})
