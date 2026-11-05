import { describe, expect, it } from 'vitest'
import { createBillboardStyle, createCesiumScene, parseCesiumScene, validateGraphic } from './index'
import type { GraphicNode } from './index'

function graphic(): GraphicNode {
  return { id: 'area', name: 'Area', type: 'graphic', visible: true, geometry: { type: 'polygon', positions: [[116,39,0],[116.1,39,0],[116,39.1,0]], heightMode: 'ground' }, style: { color: '#336699', width: 3, pointSize: 10, label: 'Zone' }, properties: { population: 42, nested: { tags: ['city'] } }, popup: { fields: [{ field: 'population', label: 'Population' }] }, locked: true }
}

describe('serializable graphics', () => {
  it.each(['rectangle','ellipse'] as const)('preserves fixed %s controls and rejects degenerate, oversized and mismatched height input', type => {
    const node = graphic(); node.geometry = { type, heightMode: 'absolute', positions: [[116,39,12],[116.01,39.02,12]] }
    expect(validateGraphic(node)).toBe(true)
    const scene = createCesiumScene(); scene.nodes.push(node)
    expect(parseCesiumScene(JSON.stringify(scene))).toEqual(scene)
    for (const positions of [[[116,39,12],[116,40,12]], [[179,39,12],[-179,40,12]], [[116,39,12],[116.01,39.02,13]], [[116,39,12],[116.01,39.02,12],[116.02,39,12]]]) expect(validateGraphic({ ...node, geometry: { ...node.geometry, positions } })).toBe(false)
    if (type === 'ellipse') {
      expect(validateGraphic({ ...node, geometry: { ...node.geometry, positions: [[116,39,12],[140,40,12]] } })).toBe(false)
      expect(validateGraphic({ ...node, geometry: { ...node.geometry, positions: [[116,86,12],[117,87,12]] } })).toBe(false)
    }
  })
  it('round trips independent billboard defaults and rejects unsafe or malformed images and sizes', () => {
    const node = graphic(); node.geometry = { type: 'point', positions: [[116,39,12]], heightMode: 'absolute' }
    node.style.billboard = createBillboardStyle()
    expect(validateGraphic(node)).toBe(true)
    const scene = createCesiumScene(); scene.nodes.push(node)
    expect(parseCesiumScene(JSON.stringify(scene))).toEqual(scene)
    node.style.billboard.width = 64
    expect(createBillboardStyle().width).toBe(32)
    for (const image of ['javascript:alert(1)', 'file:///C:/icon.png', 'blob:temporary', 'https://example.test/icon?token=secret', 'https://user:secret@example.test/icon.png', '']) expect(validateGraphic({ ...node, style: { ...node.style, billboard: { ...node.style.billboard, image } } })).toBe(false)
    expect(validateGraphic({ ...node, style: { ...node.style, billboard: { ...node.style.billboard, height: 513 } } })).toBe(false)
    expect(validateGraphic({ ...graphic(), style: node.style })).toBe(false)
  })
  it('round trips geometry, style, properties, popup and lock without sharing references', () => {
    const scene = createCesiumScene(); scene.nodes.push(graphic())
    const result = parseCesiumScene(JSON.stringify(scene))
    expect(result).toEqual(scene)
    result.nodes[0].name = 'Changed'
    expect(scene.nodes[0].name).toBe('Area')
  })
  it('reads legacy v1 scenes but requires v2 for graphics and lighting', () => {
    const scene = createCesiumScene(); scene.version = 1
    expect(parseCesiumScene(scene).version).toBe(1)
    scene.nodes.push(graphic()); expect(() => parseCesiumScene(scene)).toThrow('version 2')
    scene.nodes = []; scene.lighting = { sunlight: true, shadows: false, time: '2026-10-04T12:00:00Z' }
    expect(() => parseCesiumScene(scene)).toThrow('version 2')
    scene.version = 2; expect(parseCesiumScene(scene).lighting).toEqual(scene.lighting)
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
