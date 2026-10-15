import { getCesiumSceneGroupState, getCesiumSceneNodeState } from '@desktop-webgis/cesium-scene-schema'
import type { CesiumScene, CesiumSceneNode } from '@desktop-webgis/cesium-scene-schema'

/** Apply against the exact object revision opened by the property window. */
export function applyScenePropertyDraft(scene: CesiumScene, base: CesiumSceneNode, draft: CesiumSceneNode): CesiumScene {
  const current = scene.nodes.find(node => node.id === base.id)
  if (!current) throw new Error('对象已删除，请关闭此窗口。')
  if (getCesiumSceneNodeState(scene, current).locked) throw new Error('对象或所属文件夹已锁定，无法应用。')
  if (JSON.stringify(current) !== JSON.stringify(base)) throw new Error('对象已被其他操作修改，请重新载入后编辑。')
  if (draft.id !== base.id || draft.type !== base.type) throw new Error('不能修改对象标识或类型。')
  if (!draft.name.trim()) throw new Error('请输入对象名称。')
  if (getCesiumSceneGroupState(scene, draft.groupId).locked) throw new Error('目标文件夹已锁定，无法移动对象。')
  return { ...scene, nodes: scene.nodes.map(node => node.id === base.id ? structuredClone(draft) : node) }
}
