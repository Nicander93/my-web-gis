import type { CityGroup, CityNode, CityScene } from './index.js'

/** Ancestor flags are combined at render/edit time, never copied into children. */
export function getCityGroupState(scene: CityScene, id?: string): { visible: boolean; locked: boolean } {
  let visible = true, locked = false
  const seen = new Set<string>()
  while (id) {
    if (seen.has(id)) throw new Error('文件夹层级不能成环')
    seen.add(id)
    const group = scene.groups?.find(group => group.id === id)
    if (!group) throw new Error('文件夹不存在')
    visible = visible && group.visible; locked = locked || !!group.locked
    id = group.parentId
  }
  return { visible, locked }
}

export function getCityNodeState(scene: CityScene, node: CityNode): { visible: boolean; locked: boolean } {
  const group = getCityGroupState(scene, node.groupId)
  return { visible: node.visible && group.visible, locked: !!node.locked || group.locked }
}

/** Stable descendant object IDs support selection, search and subtree operations. */
export function getCityDescendantIds(scene: CityScene, groupId: string): string[] {
  const descendants = new Set([groupId])
  for (let changed = true; changed;) {
    changed = false
    for (const group of scene.groups ?? []) if (group.parentId && descendants.has(group.parentId) && !descendants.has(group.id)) {
      descendants.add(group.id); changed = true
    }
  }
  return scene.nodes.filter(node => node.groupId && descendants.has(node.groupId)).map(node => node.id)
}

/** Move/reorder a selection atomically. No UI, viewer or project-store dependency. */
export function moveCityNodes(scene: CityScene, ids: readonly string[], groupId?: string, beforeId?: string): CityScene {
  const selected = new Set(ids), nodes = scene.nodes.filter(node => selected.has(node.id))
  if (!nodes.length || nodes.length !== selected.size) throw new Error('请选择存在的对象')
  if (nodes.some(node => getCityNodeState(scene, node).locked)) throw new Error('选中对象或其文件夹已锁定')
  if (getCityGroupState(scene, groupId).locked) throw new Error('目标文件夹或其父级已锁定')
  if (beforeId && !selected.has(beforeId) && !scene.nodes.some(node => node.id === beforeId && node.groupId === groupId)) throw new Error('排序目标不在目标文件夹中')
  if (beforeId && selected.has(beforeId)) return structuredClone(scene)
  const rest = scene.nodes.filter(node => !selected.has(node.id)).map(node => structuredClone(node))
  const moved = nodes.map(node => { const copy = structuredClone(node); if (groupId === undefined) delete copy.groupId; else copy.groupId = groupId; return copy })
  const index = beforeId ? rest.findIndex(node => node.id === beforeId) : rest.length
  rest.splice(index, 0, ...moved)
  return { ...structuredClone(scene), version: 2, nodes: rest }
}

export function moveCityGroup(scene: CityScene, id: string, parentId?: string, beforeId?: string): CityScene {
  const source = scene.groups?.find(group => group.id === id)
  if (!source) throw new Error('文件夹不存在')
  if (getCityGroupState(scene, id).locked || getCityGroupState(scene, parentId).locked) throw new Error('文件夹或其父级已锁定')
  let parent = parentId
  while (parent) {
    if (parent === id) throw new Error('不能将文件夹移入自身或后代')
    parent = scene.groups?.find(group => group.id === parent)?.parentId
  }
  if (beforeId === id) return structuredClone(scene)
  if (beforeId && !scene.groups?.some(group => group.id === beforeId && group.parentId === parentId)) throw new Error('排序目标不在目标文件夹中')
  const next = structuredClone(scene)
  const moved: CityGroup = { ...source }
  if (parentId) moved.parentId = parentId; else delete moved.parentId
  const rest = next.groups?.filter(group => group.id !== id) ?? []
  rest.splice(beforeId ? rest.findIndex(group => group.id === beforeId) : rest.length, 0, moved)
  return { ...next, groups: rest }
}

/** Dissolve a folder in place, retaining descendants and their effective visibility. */
export function removeCityGroup(scene: CityScene, id: string): CityScene {
  const group = scene.groups?.find(group => group.id === id)
  if (!group) throw new Error('分组不存在')
  if (getCityGroupState(scene, id).locked) throw new Error('请先解锁文件夹及其父级')
  const next = structuredClone(scene)
  next.groups = next.groups?.filter(item => item.id !== id).map(child => {
    if (child.parentId !== id) return child
    child.visible = child.visible && group.visible
    if (group.parentId) child.parentId = group.parentId; else delete child.parentId
    return child
  })
  next.nodes = next.nodes.map(node => {
    if (node.groupId !== id) return node
    node.visible = node.visible && group.visible
    if (group.parentId) node.groupId = group.parentId; else delete node.groupId
    return node
  })
  return next
}
