import type { CityNode, CityScene } from './index.js'

/** Group state is inherited at render/edit time; original node flags remain serializable. */
export function getCityNodeState(scene: CityScene, node: CityNode): { visible: boolean; locked: boolean } {
  const group = scene.groups?.find(group => group.id === node.groupId)
  return { visible: node.visible && (group?.visible ?? true), locked: !!node.locked || !!group?.locked }
}

/** Move/reorder a selection atomically. No UI, viewer or project-store dependency. */
export function moveCityNodes(scene: CityScene, ids: readonly string[], groupId?: string, beforeId?: string): CityScene {
  const selected = new Set(ids), nodes = scene.nodes.filter(node => selected.has(node.id))
  if (!nodes.length || nodes.length !== selected.size) throw new Error('请选择存在的对象')
  if (nodes.some(node => getCityNodeState(scene, node).locked)) throw new Error('选中对象或其分组已锁定')
  if (groupId !== undefined) {
    const group = scene.groups?.find(group => group.id === groupId)
    if (!group) throw new Error('目标分组不存在')
    if (group.locked) throw new Error('目标分组已锁定')
  }
  if (beforeId && !selected.has(beforeId) && !scene.nodes.some(node => node.id === beforeId && node.groupId === groupId)) throw new Error('排序目标不在目标分组中')
  if (beforeId && selected.has(beforeId)) return structuredClone(scene)
  const rest = scene.nodes.filter(node => !selected.has(node.id)).map(node => structuredClone(node))
  const moved = nodes.map(node => { const copy = structuredClone(node); if (groupId === undefined) delete copy.groupId; else copy.groupId = groupId; return copy })
  const index = beforeId ? rest.findIndex(node => node.id === beforeId) : rest.length
  rest.splice(index, 0, ...moved)
  return { ...structuredClone(scene), version: 2, nodes: rest }
}

/** Dissolve a folder without deleting members or changing their effective visibility. */
export function removeCityGroup(scene: CityScene, id: string): CityScene {
  const group = scene.groups?.find(group => group.id === id)
  if (!group) throw new Error('分组不存在')
  if (group.locked) throw new Error('请先解锁分组')
  const next = structuredClone(scene)
  next.groups = next.groups?.filter(group => group.id !== id)
  next.nodes = next.nodes.map(node => {
    if (node.groupId !== id) return node
    const state = getCityNodeState(scene, node)
    delete node.groupId; node.visible = state.visible; return node
  })
  return next
}
