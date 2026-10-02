import { describe, expect, it } from 'vitest'
import { createCityScene, createTransform, isCityResourceUrl, parseCityScene, validateCityScene } from './index'

describe('city scene contract', () => {
  it('accepts a detached city scene with a georeferenced tileset', () => {
    const scene = createCityScene()
    scene.assets.city = { type: '3dtiles', url: './city/tileset.json' }
    scene.nodes.push({ id: 'city', name: 'City', visible: true, type: '3dtiles', asset: 'city', transform: createTransform() })
    const result = parseCityScene(JSON.stringify(scene))
    expect(result).toEqual(scene)
    result.nodes[0].name = 'Changed'
    expect(scene.nodes[0].name).toBe('City')
  })
  it('reports duplicate IDs, mismatched assets and invalid transforms', () => {
    const scene = createCityScene()
    scene.assets.city = { type: 'glb', url: './city.glb' }
    const node = { id: 'city', name: 'City', visible: true, type: '3dtiles' as const, asset: 'city', transform: { ...createTransform(), scale: 0 } }
    scene.nodes = [node,structuredClone(node)]
    const paths = validateCityScene(scene).map(issue => issue.path)
    expect(paths).toContain('$.nodes[0].asset')
    expect(paths).toContain('$.nodes[0].transform')
    expect(paths).toContain('$.nodes[1].id')
  })
  it('rejects invalid water coordinates and parameters', () => {
    const scene = createCityScene()
    scene.nodes.push({ id:'water',name:'Water',visible:true,type:'water',boundary:[[0,0,0],[0,0,0],[181,0,0]],height:0,color:'#abcdef',amplitude:-1,frequency:100,speed:.02 })
    expect(() => parseCityScene(scene)).toThrow('boundary')
  })
  it.each(['file:///c:/secret.glb','../secret.glb','/absolute.glb','javascript:alert(1)','https://user:pass@host/model.glb','https://host/tileset.json?token=secret'])('rejects unsafe or credential-bearing URL %s', url => {
    expect(isCityResourceUrl(url)).toBe(false)
  })
  it('accepts imagery URL templates and normal service parameters', () => {
    expect(isCityResourceUrl('https://host/{z}/{x}/{y}.png?style=night')).toBe(true)
  })
})
