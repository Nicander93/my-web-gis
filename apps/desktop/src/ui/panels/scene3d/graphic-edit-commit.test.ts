import { expect, it } from 'vitest'
import { createCesiumScene, type GraphicNode } from '@desktop-webgis/cesium-scene-schema'
import { applyGraphicGeometryEdit } from './graphic-edit-commit'

function setup() {
  const scene = createCesiumScene()
  const node: GraphicNode = { id: 'line', name: 'Line', type: 'graphic', visible: true, geometry: { type: 'polyline', heightMode: 'ground', positions: [[116, 39, 0], [116.1, 39.1, 0]] }, style: { color: '#336699', width: 3, pointSize: 10 }, properties: {} }
  scene.nodes.push(node)
  return { scene, node, after: { ...structuredClone(node.geometry), positions: [[116.01, 39, 0], [116.1, 39.1, 0]] as [number, number, number][] } }
}
it('replaces only the original geometry and detaches the completed preview', () => {
  const { scene, node, after } = setup(), before = structuredClone(scene)
  const edited = applyGraphicGeometryEdit(scene, node.id, node.geometry, after)
  expect(edited.nodes[0]).toEqual({ ...node, geometry: after })
  after.positions[0][0] = 120
  expect((edited.nodes[0] as GraphicNode).geometry.positions[0][0]).toBe(116.01)
  expect(scene).toEqual(before)
})
it.each(['removed', 'locked', 'hidden', 'folder-lock', 'changed'])('rejects an invalidated %s target without changing the current scene', reason => {
  const { scene, node, after } = setup(), original = structuredClone(node.geometry)
  if (reason === 'removed') scene.nodes = []
  if (reason === 'locked') node.locked = true
  if (reason === 'hidden') node.visible = false
  if (reason === 'folder-lock') { scene.groups = [{ id: 'folder', name: 'Folder', visible: true, locked: true }]; node.groupId = 'folder' }
  if (reason === 'changed') node.geometry.positions[0][0] = 115
  const current = structuredClone(scene)
  expect(() => applyGraphicGeometryEdit(scene, node.id, original, after)).toThrow()
  expect(scene).toEqual(current)
})
