import { getCesiumSceneNodeState, type CesiumScene, type GraphicGeometry } from '@desktop-webgis/cesium-scene-schema'

/** A preview can only replace the exact geometry it started from. */
export function applyGraphicGeometryEdit(scene: CesiumScene, id: string, before: GraphicGeometry, after: GraphicGeometry): CesiumScene {
  const node = scene.nodes.find(node => node.id === id)
  if (!node || node.type !== 'graphic') throw new Error('编辑对象已删除，本次修改未提交')
  const state = getCesiumSceneNodeState(scene, node)
  if (state.locked || !state.visible) throw new Error('编辑对象已锁定或隐藏，本次修改未提交')
  if (JSON.stringify(node.geometry) !== JSON.stringify(before)) throw new Error('对象几何已被其他操作修改，请重新开始编辑')
  return { ...scene, nodes: scene.nodes.map(item => item.id === id ? { ...node, geometry: structuredClone(after) } : item) }
}
