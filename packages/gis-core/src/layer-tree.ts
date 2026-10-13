import type { Layer, LayerGroup, LayerTreeEntry, Project } from './types'
import { createId } from './id'

export function createLayerGroup(name = '新建组', layerIds: string[] = []): LayerGroup {
  return { id: createId('group'), name, visible: true, layerIds: [...layerIds] }
}

export function groupedLayerIdSet(project: Project): Set<string> {
  return new Set(project.groups?.flatMap(group => group.layerIds) ?? [])
}

/** Validate hierarchy and migrate legacy membership/order without losing valid folders. */
export function normalizeLayerTree(project: Project): Project {
  const layerIds = new Set(project.layers.map(layer => layer.id))
  const groups = (project.groups ?? []).map(group => {
    if (!Array.isArray(group.layerIds) || !group.layerIds.every(id => typeof id === 'string') || typeof group.name !== 'string' || typeof group.visible !== 'boolean' || group.locked !== undefined && typeof group.locked !== 'boolean') throw new Error('文件夹名称、成员或状态无效')
    return { ...group, layerIds: group.layerIds.filter(id => layerIds.has(id)) }
  })
  const groupIds = new Set<string>()
  const used = new Set<string>()
  for (const group of groups) {
    if (!group.id || groupIds.has(group.id) || layerIds.has(group.id)) throw new Error('文件夹 ID 为空、重复或与图层冲突')
    groupIds.add(group.id)
    for (const id of group.layerIds) {
      if (used.has(id)) throw new Error('图层不能同时属于多个文件夹')
      used.add(id)
    }
  }
  for (const group of groups) {
    const seen = new Set([group.id])
    let parent = group.parentId
    while (parent !== undefined) {
      if (!groupIds.has(parent)) throw new Error('父文件夹不存在')
      if (seen.has(parent)) throw new Error('文件夹层级不能成环')
      seen.add(parent); parent = groups.find(item => item.id === parent)?.parentId
    }
  }
  function normalizeOrder(input: LayerTreeEntry[], available: LayerTreeEntry[]): LayerTreeEntry[] {
    const valid = new Map(available.map(entry => [`${entry.type}:${entry.id}`, entry]))
    const result: LayerTreeEntry[] = []
    for (const entry of input) {
      if (!entry || !['layer', 'group'].includes(entry.type) || typeof entry.id !== 'string') throw new Error('不支持的树对象；项目未被修改')
      const key = `${entry.type}:${entry.id}`, existing = valid.get(key)
      if (existing) { result.push(existing); valid.delete(key) }
    }
    result.push(...valid.values()); return result
  }
  for (const group of groups) {
    const folders = groups.filter(item => item.parentId === group.id).map(item => ({ type: 'group' as const, id: item.id }))
    if (group.childOrder || folders.length) group.childOrder = normalizeOrder(group.childOrder ?? [], [...group.layerIds.map(id => ({ type: 'layer' as const, id })), ...folders])
  }
  const roots: LayerTreeEntry[] = [...groups.filter(group => !group.parentId).map(group => ({ type: 'group' as const, id: group.id })), ...project.layers.filter(layer => !used.has(layer.id)).map(layer => ({ type: 'layer' as const, id: layer.id }))]
  return { ...project, groups, rootOrder: normalizeOrder(project.rootOrder ?? [], roots) }
}

/** Children in the exact displayed order, including folders and layers. */
export function getLayerTreeChildren(project: Project, parentId?: string): LayerTreeEntry[] {
  if (!parentId) return project.rootOrder
  const group = project.groups.find(group => group.id === parentId)
  return group?.childOrder ?? group?.layerIds.map(id => ({ type: 'layer', id })) ?? []
}

export function flattenLayerIds(project: Project): string[] {
  const normalized = normalizeLayerTree(project), result: string[] = []
  function visit(parentId?: string): void {
    for (const entry of getLayerTreeChildren(normalized, parentId)) {
      if (entry.type === 'layer') result.push(entry.id)
      else visit(entry.id)
    }
  }
  visit(); return result
}

export function getLayerGroupLayerIds(project: Project, groupId: string): string[] {
  const result: string[] = []
  function visit(id: string): void {
    for (const entry of getLayerTreeChildren(project, id)) {
      if (entry.type === 'layer') result.push(entry.id)
      else visit(entry.id)
    }
  }
  visit(groupId); return result
}

export function flattenLayers(project: Project): Layer[] {
  const byId = new Map(project.layers.map(layer => [layer.id, layer]))
  return flattenLayerIds(project).map(id => byId.get(id)).filter((layer): layer is Layer => layer !== undefined)
}

export function findGroupForLayer(project: Project, layerId: string): LayerGroup | null {
  return project.groups?.find(group => group.layerIds.includes(layerId)) ?? null
}

export function getLayerGroupState(project: Project, id?: string): { visible: boolean; locked: boolean } {
  let visible = true, locked = false
  const seen = new Set<string>()
  while (id) {
    if (seen.has(id)) throw new Error('文件夹层级不能成环')
    seen.add(id)
    const group = project.groups?.find(group => group.id === id)
    if (!group) throw new Error('文件夹不存在')
    visible = visible && group.visible; locked = locked || !!group.locked; id = group.parentId
  }
  return { visible, locked }
}

export function getEffectiveVisible(project: Project, layerId: string): boolean {
  const layer = project.layers.find(layer => layer.id === layerId)
  return !!layer?.visible && getLayerGroupState(project, findGroupForLayer(project, layerId)?.id).visible
}

export function getEffectiveLocked(project: Project, layerId: string): boolean {
  return getLayerGroupState(project, findGroupForLayer(project, layerId)?.id).locked
}

export function layerListZIndex(listIndex: number, layerCount: number, base = 10): number {
  return base + layerCount - 1 - listIndex
}

export function layersWithEffectiveVisibility(project: Project): Layer[] {
  return flattenLayers(project).map(layer => ({ ...layer, visible: getEffectiveVisible(project, layer.id), editable: layer.editable && !getEffectiveLocked(project, layer.id) }))
}

/** Atomic reparent/reorder used by drag/drop and keyboard actions. */
export function moveLayerTreeEntry(input: Project, entry: LayerTreeEntry, parentId?: string, index = Number.MAX_SAFE_INTEGER): Project {
  const project = normalizeLayerTree(structuredClone(input))
  const sourceParent = entry.type === 'group' ? project.groups.find(group => group.id === entry.id)?.parentId : findGroupForLayer(project, entry.id)?.id
  if (entry.type === 'group' ? !project.groups.some(group => group.id === entry.id) : !project.layers.some(layer => layer.id === entry.id)) throw new Error('树对象不存在')
  if (getLayerGroupState(project, entry.type === 'group' ? entry.id : sourceParent).locked || getLayerGroupState(project, parentId).locked) throw new Error('文件夹或其父级已锁定')
  if (entry.type === 'group') {
    let parent = parentId
    while (parent) {
      if (parent === entry.id) throw new Error('不能将文件夹移入自身或后代')
      parent = project.groups.find(group => group.id === parent)?.parentId
    }
  }
  const same = (item: LayerTreeEntry) => item.type === entry.type && item.id === entry.id
  project.rootOrder = project.rootOrder.filter(item => !same(item))
  for (const group of project.groups) {
    if (entry.type === 'layer') group.layerIds = group.layerIds.filter(id => id !== entry.id)
    if (group.childOrder) group.childOrder = group.childOrder.filter(item => !same(item))
  }
  if (entry.type === 'group') {
    const group = project.groups.find(group => group.id === entry.id)!
    if (parentId) group.parentId = parentId; else delete group.parentId
  }
  const order = [...getLayerTreeChildren(project, parentId)].filter(item => !same(item))
  order.splice(Math.max(0, Math.min(index, order.length)), 0, entry)
  if (parentId) {
    const group = project.groups.find(group => group.id === parentId)!
    group.childOrder = order
    group.layerIds = order.filter(item => item.type === 'layer').map(item => item.id)
  } else project.rootOrder = order
  return normalizeLayerTree(project)
}

/** Remove a folder alone and splice its children into its former sibling position. */
export function dissolveLayerGroup(input: Project, id: string): Project {
  let project = normalizeLayerTree(structuredClone(input))
  const group = project.groups.find(group => group.id === id)
  if (!group) throw new Error('文件夹不存在')
  if (getLayerGroupState(project, id).locked) throw new Error('请先解锁文件夹及其父级')
  const children = [...getLayerTreeChildren(project, id)]
  let index = getLayerTreeChildren(project, group.parentId).findIndex(entry => entry.type === 'group' && entry.id === id)
  for (const entry of children) {
    if (!group.visible) {
      if (entry.type === 'group') project.groups.find(item => item.id === entry.id)!.visible = false
      else project.layers.find(layer => layer.id === entry.id)!.visible = false
    }
    project = moveLayerTreeEntry(project, entry, group.parentId, index++)
  }
  project.groups = project.groups.filter(item => item.id !== id)
  return normalizeLayerTree(project)
}
