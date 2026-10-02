import { describe, expect, it } from 'vitest'
import { createCityScene } from '@desktop-webgis/cesium-scene-schema'
import { parseScene } from './parse'

describe('SceneManifest city extension', () => {
  const base = { version:2,id:'city',title:'City',view:{projection:'EPSG:3857',center:[0,0],zoom:2},sources:{},layers:[] }
  it('preserves the versioned extension and old 2D documents', () => {
    expect(parseScene(base).city).toBeUndefined()
    expect(parseScene({ ...base,city:createCityScene() }).city).toEqual(createCityScene())
    expect(parseScene({ ...base,version:1 }).version).toBe(2)
  })
  it('reports errors at the city extension path', () => {
    expect(() => parseScene({ ...base,city:{ ...createCityScene(),camera:{ position:[200,0,0],heading:0,pitch:0,roll:0 } } })).toThrow('$.city.camera')
  })
  it('does not pretend a city scene is a v1 document', () => {
    expect(() => parseScene({ ...base,version:1,city:createCityScene() })).toThrow('version 2')
  })
})
