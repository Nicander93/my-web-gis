import { describe, expect, it } from 'vitest'
import { createCesiumScene, createTransform } from '@desktop-webgis/cesium-scene-schema'
import type { GraphicNode } from '@desktop-webgis/cesium-scene-schema'
import { applyScenePropertyDraft } from './scene-property-session'

const point: GraphicNode = { id: 'a', type: 'graphic', name: 'A', visible: true, geometry: { type: 'point', heightMode: 'ground', positions: [[116, 39, 0]] }, properties: {}, style: { color: '#336699', width: 3, pointSize: 8 } }
describe('object-bound property draft', () => {
  it('rejects invalid native style atomically and preserves complex legal style fields', () => {
    const scene = createCesiumScene()
    const base = { id: 'tiles', type: '3dtiles' as const, name: 'Tiles', visible: true, asset: 'tiles', transform: createTransform(), style: { color: 'color("white")' } }
    scene.nodes = [base]
    expect(() => applyScenePropertyDraft(scene, base, { ...base, style: { color: 'color(' } })).toThrow()
    expect(scene.nodes[0]).toEqual(base)
    const style = { defines: { height: '${Height}' }, color: { conditions: [['${height} > 10', 'color("red")'], ['true', 'color("white")']] }, meta: { name: '${name}' } }
    const next = applyScenePropertyDraft(scene, base, { ...base, style })
    expect(next.nodes[0]).toMatchObject({ style })
    expect(scene.nodes[0]).toEqual(base)
  })
  it('changes only the bound ID and preserves unrelated newer objects', () => {
    const scene = createCesiumScene(); scene.nodes = [structuredClone(point), { ...structuredClone(point), id: 'b', name: 'New B' }]
    const result = applyScenePropertyDraft(scene, point, { ...point, name: 'Applied A' })
    expect(result.nodes.map(node => node.name)).toEqual(['Applied A', 'New B'])
    expect(scene.nodes[0].name).toBe('A')
  })
  it('rejects stale drafts, deleted targets and inherited locking', () => {
    const scene = createCesiumScene(); scene.nodes = [{ ...point, name: 'Externally changed' }]
    expect(() => applyScenePropertyDraft(scene, point, point)).toThrow('其他操作')
    scene.nodes = []
    expect(() => applyScenePropertyDraft(scene, point, point)).toThrow('已删除')
    scene.groups = [{ id: 'locked', name: 'Locked', locked: true, visible: true }]
    scene.nodes = [structuredClone(point)]
    expect(() => applyScenePropertyDraft(scene, point, { ...point, groupId: 'locked' })).toThrow('目标文件夹已锁定')
    scene.nodes = [{ ...point, groupId: 'locked' }]
    expect(() => applyScenePropertyDraft(scene, scene.nodes[0], scene.nodes[0])).toThrow('已锁定')
  })
})
