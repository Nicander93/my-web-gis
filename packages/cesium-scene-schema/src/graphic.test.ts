import { describe, expect, it } from 'vitest'
import { createCityScene, parseCityScene, validateGraphic } from './index'
import type { GraphicNode } from './index'

function graphic(): GraphicNode {
  return { id: 'area', name: 'Area', type: 'graphic', visible: true, geometry: { type: 'polygon', positions: [[116,39,0],[116.1,39,0],[116,39.1,0]], heightMode: 'ground' }, style: { color: '#336699', width: 3, pointSize: 10, label: 'Zone' }, properties: { population: 42, nested: { tags: ['city'] } }, popup: { fields: [{ field: 'population', label: 'Population' }] }, locked: true }
}

describe('serializable graphics', () => {
  it('round trips geometry, style, properties, popup and lock without sharing references', () => {
    const scene = createCityScene(); scene.nodes.push(graphic())
    const result = parseCityScene(JSON.stringify(scene))
    expect(result).toEqual(scene)
    result.nodes[0].name = 'Changed'
    expect(scene.nodes[0].name).toBe('Area')
  })
  it('reads legacy v1 scenes but requires v2 for graphics and lighting', () => {
    const scene = createCityScene(); scene.version = 1
    expect(parseCityScene(scene).version).toBe(1)
    scene.nodes.push(graphic()); expect(() => parseCityScene(scene)).toThrow('version 2')
    scene.nodes = []; scene.lighting = { sunlight: true, shadows: false, time: '2026-10-04T12:00:00Z' }
    expect(() => parseCityScene(scene)).toThrow('version 2')
    scene.version = 2; expect(parseCityScene(scene).lighting).toEqual(scene.lighting)
  })
  it('rejects undersized geometry, vertically repeated polygon vertices and invalid style', () => {
    const node = graphic(); node.geometry.positions = [[0,0,0],[0,0,10],[1,1,0]]
    expect(validateGraphic(node)).toBe(false)
    node.geometry.type = 'point'; node.geometry.positions = [[0,0,0],[1,1,0]]
    expect(validateGraphic(node)).toBe(false)
    node.geometry.type = 'polyline'; node.geometry.positions = [[0,0,0]]
    expect(validateGraphic(node)).toBe(false)
    const styled = graphic(); styled.style.width = 0
    expect(validateGraphic(styled)).toBe(false)
  })
  it('rejects non-JSON properties, cycles and malformed standalone popup definitions', () => {
    for (const value of [undefined, NaN, () => {}, new Date()]) {
      const node = graphic(); node.properties.bad = value
      expect(validateGraphic(node)).toBe(false)
    }
    const node = graphic(); node.properties.self = node.properties
    expect(validateGraphic(node)).toBe(false)
    expect(validateGraphic({ ...graphic(), popup: { fields: 'invalid' } })).toBe(false)
  })
})
