/**
 * Single-level layer groups and list/render order helpers.
 *
 * List convention: rootOrder[0] is top of the LayerPanel list and receives the
 * highest map z-index. Groups hold layer ID references only (no Dataset copies).
 * Hiding a group does not mutate child `Layer.visible`; effective visibility is
 * `group.visible && layer.visible`.
 */
import type { Layer, LayerGroup, LayerTreeEntry, Project } from './types'
import { createId } from './id'

export function createLayerGroup(name = '新建组', layerIds: string[] = []): LayerGroup {
  return {
    id: createId('group'),
    name,
    visible: true,
    layerIds: [...layerIds]
  }
}

/** Layers currently referenced by any group. */
export function groupedLayerIdSet(project: Project): Set<string> {
  const ids = new Set<string>()
  for (const group of project.groups ?? []) {
    for (const layerId of group.layerIds) ids.add(layerId)
  }
  return ids
}

/**
 * Ensure `groups` / `rootOrder` exist and stay consistent with `layers`.
 * Orphan group child refs and stale root entries are dropped; ungrouped layers
 * missing from rootOrder are appended.
 */
export function normalizeLayerTree(project: Project): Project {
  const layerIds = new Set(project.layers.map((layer) => layer.id))
  const groups: LayerGroup[] = (project.groups ?? [])
    .map((group) => ({
      ...group,
      layerIds: group.layerIds.filter((id) => layerIds.has(id))
    }))
    .filter((group) => layerIds.size === 0 || true)

  const usedInGroups = new Set<string>()
  for (const group of groups) {
    for (const id of group.layerIds) usedInGroups.add(id)
  }

  const groupIds = new Set(groups.map((g) => g.id))
  const seen = new Set<string>()
  const rootOrder: LayerTreeEntry[] = []

  for (const entry of project.rootOrder ?? []) {
    const key = `${entry.type}:${entry.id}`
    if (seen.has(key)) continue
    if (entry.type === 'group') {
      if (!groupIds.has(entry.id)) continue
      seen.add(key)
      rootOrder.push(entry)
      continue
    }
    if (!layerIds.has(entry.id) || usedInGroups.has(entry.id)) continue
    seen.add(key)
    rootOrder.push(entry)
  }

  for (const group of groups) {
    const key = `group:${group.id}`
    if (!seen.has(key)) {
      seen.add(key)
      rootOrder.push({ type: 'group', id: group.id })
    }
  }

  for (const layer of project.layers) {
    if (usedInGroups.has(layer.id)) continue
    const key = `layer:${layer.id}`
    if (!seen.has(key)) {
      seen.add(key)
      rootOrder.push({ type: 'layer', id: layer.id })
    }
  }

  return { ...project, groups, rootOrder }
}

/** Top-to-bottom layer IDs matching the LayerPanel list. */
export function flattenLayerIds(project: Project): string[] {
  const normalized = normalizeLayerTree(project)
  const groups = normalized.groups
  const rootOrder = normalized.rootOrder
  const layerById = new Map(normalized.layers.map((layer) => [layer.id, layer]))
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const result: string[] = []

  for (const entry of rootOrder) {
    if (entry.type === 'layer') {
      if (layerById.has(entry.id)) result.push(entry.id)
      continue
    }
    const group = groupById.get(entry.id)
    if (!group) continue
    for (const layerId of group.layerIds) {
      if (layerById.has(layerId)) result.push(layerId)
    }
  }
  return result
}

/** Layers in list order (top → bottom). */
export function flattenLayers(project: Project): Layer[] {
  const byId = new Map(project.layers.map((layer) => [layer.id, layer]))
  return flattenLayerIds(project)
    .map((id) => byId.get(id))
    .filter((layer): layer is Layer => layer != null)
}

export function findGroupForLayer(project: Project, layerId: string): LayerGroup | null {
  for (const group of project.groups ?? []) {
    if (group.layerIds.includes(layerId)) return group
  }
  return null
}

/**
 * Effective map visibility: group hide overrides without changing child.visible.
 */
export function getEffectiveVisible(project: Project, layerId: string): boolean {
  const layer = project.layers.find((item) => item.id === layerId)
  if (!layer) return false
  const group = findGroupForLayer(project, layerId)
  if (group && !group.visible) return false
  return layer.visible
}

/** Map z-index for a layer at list index (0 = top of list = highest z). */
export function layerListZIndex(listIndex: number, layerCount: number, base = 10): number {
  return base + (layerCount - 1 - listIndex)
}

export function layersWithEffectiveVisibility(project: Project): Layer[] {
  return flattenLayers(project).map((layer) => ({
    ...layer,
    visible: getEffectiveVisible(project, layer.id)
  }))
}
