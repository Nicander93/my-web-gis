import type { CesiumScene } from '@desktop-webgis/cesium-scene-schema'
import { getLayerCartography } from '../config/cartography'
import type { EditTargets } from './editHistory'
import type { MapContent, Project } from '../config/types'

/** Structural configuration equality 忽略s object key insertion order. */
export function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>, keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
}

/** 合并命令的目标时，不检查要素数据，也不保留调用方可变的列表。 */
export function mergeEditTargets(...targets: Array<EditTargets | undefined>): EditTargets {
  const result: Record<string, readonly string[]> = {}
  for (const key of ['datasetIds', 'layerIds', 'groupIds', 'sceneNodeIds', 'sceneGroupIds'] as const) {
    const ids = [...new Set(targets.flatMap(target => target?.[key] ?? []))]
    if (ids.length) result[key] = Object.freeze(ids)
  }
  return Object.freeze(result)
}

interface GroupDefinition { id: string; parentId?: string; visible: boolean; locked?: boolean }

function groupTargets<T extends GroupDefinition>(before: T[], after: T[]): string[] {
  const previous = new Map(before.map(group => [group.id, group])), next = new Map(after.map(group => [group.id, group]))
  const ids = new Set<string>()
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(id), current = next.get(id)
    const a = old ? { ...old, locked: !!old.locked } : undefined, b = current ? { ...current, locked: !!current.locked } : undefined
    if (a && b && sameValue(a, b)) continue
    if (a && b && sameValue({ ...a, visible: b.visible }, b)) continue
    if (a?.parentId) ids.add(a.parentId)
    if (b?.parentId) ids.add(b.parentId)
    // 父级未锁定时，仍然必须能够显式切换这一级的本地锁定。
    if (!a || !b || !sameValue({ ...a, visible: b.visible, locked: b.locked }, b)) ids.add(id)
  }
  return [...ids]
}

/** 图层树的配置守卫会保留可见性，以及本地解锁的例外情况。 */
export function getLayerTreeEditTargets(before: Pick<MapContent, 'layers' | 'groups'>, after: Pick<MapContent, 'layers' | 'groups'>): EditTargets {
  const previous = new Map(before.layers.map(layer => [layer.id, layer])), next = new Map(after.layers.map(layer => [layer.id, layer]))
  const membership = (groups: MapContent['groups']) => new Map(groups.flatMap(group => group.layerIds.map(id => [id, group.id] as const)))
  const oldParent = membership(before.groups), newParent = membership(after.groups)
  const layers = new Set<string>(), groups = new Set(groupTargets(before.groups, after.groups))
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(id), current = next.get(id)
    const a = old ? { ...old, locked: !!old.locked } : undefined, b = current ? { ...current, locked: !!current.locked } : undefined
    const changed = !a || !b || !sameValue({ ...a, visible: b.visible }, b)
    const localLockOnly = a && b && a.locked !== b.locked && sameValue({ ...a, visible: b.visible, locked: b.locked }, b)
    if (changed && !localLockOnly) layers.add(id)
    if (changed) {
      const oldId = oldParent.get(id), newId = newParent.get(id)
      if (oldId) groups.add(oldId)
      if (newId) groups.add(newId)
    }
    if (oldParent.get(id) !== newParent.get(id)) {
      layers.add(id)
      const oldId = oldParent.get(id), newId = newParent.get(id)
      if (oldId) groups.add(oldId)
      if (newId) groups.add(newId)
    }
  }
  return mergeEditTargets({ layerIds: [...layers], groupIds: [...groups] })
}

/** 场景历史会校验稳定的宿主身份，包括使用了已变更资源的节点。 */
export function getSceneEditTargets(before?: CesiumScene, after?: CesiumScene): EditTargets {
  const previous = new Map((before?.nodes ?? []).map(node => [node.id, node])), next = new Map((after?.nodes ?? []).map(node => [node.id, node]))
  const nodes = new Set<string>(), groups = new Set(groupTargets(before?.groups ?? [], after?.groups ?? []))
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    const old = previous.get(id), current = next.get(id)
    const a = old ? { ...old, locked: !!old.locked } : undefined, b = current ? { ...current, locked: !!current.locked } : undefined
    if (a && b && sameValue(a, b)) continue
    if (a && b && sameValue({ ...a, visible: b.visible }, b)) continue
    if (a?.groupId) groups.add(a.groupId)
    if (b?.groupId) groups.add(b.groupId)
    if (!a || !b || !sameValue({ ...a, visible: b.visible, locked: b.locked }, b)) nodes.add(id)
  }
  for (const id of new Set([...Object.keys(before?.assets ?? {}), ...Object.keys(after?.assets ?? {})])) {
    if (sameValue(before?.assets[id], after?.assets[id])) continue
    for (const node of [...previous.values(), ...next.values()]) if ('asset' in node && node.asset === id) nodes.add(node.id)
  }
  return mergeEditTargets({ sceneNodeIds: [...nodes], sceneGroupIds: [...groups] })
}

/** 配置历史包含元数据、图层树和标准制图的变更，永远不包含要素行。 */
export function getConfigurationEditTargets(before: Project, after: Project): EditTargets {
  if (before.metadata.id !== after.metadata.id || before.content.kind !== after.content.kind) return {}
  if (before.content.kind === 'scene3d' && after.content.kind === 'scene3d') return getSceneEditTargets(before.content.scene, after.content.scene)
  if (before.content.kind !== 'map2d' || after.content.kind !== 'map2d') return {}
  const a = before.content, b = after.content, layers = new Set<string>()
  for (const layer of a.layers) {
    if (!sameValue(getLayerCartography(before, layer.id), getLayerCartography(after, layer.id))) layers.add(layer.id)
  }
  const previous = new Map(a.datasets.map(dataset => [dataset.id, dataset])), next = new Map(b.datasets.map(dataset => [dataset.id, dataset]))
  for (const id of new Set([...previous.keys(), ...next.keys()])) {
    if (sameValue(previous.get(id), next.get(id))) continue
    for (const layer of [...a.layers, ...b.layers]) if (layer.datasetId === id) layers.add(layer.id)
  }
  return mergeEditTargets(getLayerTreeEditTargets(a, b), { layerIds: [...layers] })
}
