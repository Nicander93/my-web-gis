import { createId, cloneValue, intersectSelectionIds, isLegacyStyle, migrateLegacyStyle, normalizeLayerTree, createLayerGroup,
  findGroupForLayer, getLayerTreeChildren, getLayerGroupState, getEffectiveLocked, moveLayerTreeEntry,
  SetLayerStyleCommand, SetLayerCartographyCommand, SetLayerFilterCommand, SetLayerOpacityCommand, SetLayerTreeCommand,
  SetLayerVisibleCommand, snapshotLayerTree, getLayerCartography, requireMapContent,
  type LayerTreeEntry, type FieldFilterCondition, type CartographyState } from '@desktop-webgis/project'
import type { LayerStyle } from '@desktop-webgis/ol-style'
import { useProjectStore } from '@/session/project.store'
import { useLayerViewStore } from '@/view-state/layer-view.store'
import { getFilteredFeatures } from '@/session/feature-query'
import { projectEdits } from '@/session/project-edits'

interface LayerConfigurationCommands {
  setLayerStyle(layerId: string, style: LayerStyle, transactionId?: string): void
  setLayerCartography(layerId: string, styleLayers: CartographyState['styleLayers'], transactionId?: string): void
  setLayerFilter(layerId: string, filter: FieldFilterCondition[]): void
  clearLayerFilter(layerId: string): void
  setLayerVisible(layerId: string, visible: boolean): void
  setLayerLocked(layerId: string, locked: boolean): void
  setLayerOpacity(layerId: string, opacity: number, transactionId?: string): void
  setGroupVisible(groupId: string, visible: boolean): void
  renameLayer(layerId: string, name: string): void
  renameGroup(groupId: string, name: string): void
  moveLayer(layerId: string, direction: 'up' | 'down'): void
  moveRootEntry(entry: LayerTreeEntry, direction: 'up' | 'down'): void
  createGroup(name?: string, layerIds?: string[], parentId?: string): string | null
  relocateGroup(groupId: string, parentId?: string, index?: number): void
  setGroupLocked(groupId: string, locked: boolean): void
  relocateLayer(
    layerId: string,
    target: { kind: 'root'; index: number } | { kind: 'group'; groupId: string; index: number }
  ): void
  addLayersToGroup(groupId: string, layerIds: string[]): void
}

function reconvergeSelection(layerId: string): void {
  const session = useLayerViewStore.getState()
  if (session.selection.layerId !== layerId) return
  const featureIds = intersectSelectionIds(session.selection.featureIds, getFilteredFeatures(layerId))
  session.setSelectionState({ layerId, featureIds })
}

/** Configuration use cases prepare a complete edit before the single Application transaction publishes it. */
export const layerConfigurationCommands: LayerConfigurationCommands = {
  setLayerStyle: (layerId, style, transactionId) => {
    const state = useProjectStore.getState()
    if (getEffectiveLocked(state.project, layerId)) throw new Error('图层或所属文件夹已锁定')
    const layer = requireMapContent(state.project).layers.find((item) => item.id === layerId)
    if (!layer) return
    const before = isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : cloneValue(layer.style)
    const after = cloneValue(style)
    if (JSON.stringify(before) === JSON.stringify(after)) return
    projectEdits.execute(new SetLayerStyleCommand(createId('cmd'), layerId, before, after, transactionId))
  },

  setLayerCartography: (layerId, styleLayers, transactionId) => {
    const project = useProjectStore.getState().project
    if (getEffectiveLocked(project, layerId)) throw new Error('图层或所属文件夹已锁定')
    const before = getLayerCartography(project, layerId)
    if (!before) return
    const layers = cloneValue(styleLayers)
    const after = {
      binding: { ...before.binding, styleLayerIds: layers.map(layer => layer.id) },
      styleLayers: layers
    }
    if (JSON.stringify(before) === JSON.stringify(after)) return
    projectEdits.execute(new SetLayerCartographyCommand(createId('cmd'), layerId, before, after, transactionId))
  },

  setLayerFilter: (layerId, filter) => {
    const state = useProjectStore.getState()
    const layer = requireMapContent(state.project).layers.find((item) => item.id === layerId)
    if (!layer) return
    const before = cloneValue(layer.filter ?? [])
    const after = cloneValue(filter)
    const operators = new Set(['eq', 'neq', 'contains', 'lt', 'lte', 'gt', 'gte', 'is-empty', 'is-not-empty'])
    if (!Array.isArray(after) || after.some(condition => !condition || typeof condition.field !== 'string' || !condition.field.trim() ||
      !operators.has(condition.op) || typeof condition.value === 'number' && !Number.isFinite(condition.value))) throw new Error('图层过滤条件无效')
    // Skip no-op to avoid polluting history when reconverging after attribute edits.
    if (JSON.stringify(before) === JSON.stringify(after)) {
      reconvergeSelection(layerId)
      return
    }
    if (getEffectiveLocked(state.project, layerId)) throw new Error('图层或所属文件夹已锁定')
    projectEdits.execute(new SetLayerFilterCommand(createId('cmd'), layerId, before, after))
  },

  clearLayerFilter: (layerId) => layerConfigurationCommands.setLayerFilter(layerId, []),

  setLayerVisible: (layerId, visible) => {
    if (typeof visible !== 'boolean') throw new Error('显隐值必须是布尔值')
    const state = useProjectStore.getState(), layer = requireMapContent(state.project).layers.find(layer => layer.id === layerId)
    if (!layer || layer.visible === visible) return
    projectEdits.execute(new SetLayerVisibleCommand(createId('cmd'), layerId, layer.visible, visible))
  },

  setLayerLocked: (id, locked) => {
    if (typeof locked !== 'boolean') throw new Error('锁定值必须是布尔值')
    const state = useProjectStore.getState(), content = requireMapContent(state.project), layer = content.layers.find(layer => layer.id === id)
    if (!layer || !!layer.locked === locked) return
    if (getLayerGroupState(state.project, findGroupForLayer(state.project, id)?.id).locked) throw new Error('请先解锁父文件夹')
    const project = { ...state.project, content: { ...content, layers: content.layers.map(item => item === layer ? { ...layer, locked } : item) } }
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '设置图层锁定', snapshotLayerTree(state.project), snapshotLayerTree(project)))
  },

  setLayerOpacity: (layerId, opacity, transactionId) => {
    const state = useProjectStore.getState()
    const layer = requireMapContent(state.project).layers.find((item) => item.id === layerId)
    if (!layer) return
    if (!Number.isFinite(opacity)) throw new Error('不透明度必须是有限数值')
    const next = Math.min(1, Math.max(0, opacity))
    if (layer.opacity === next) return
    if (getEffectiveLocked(state.project, layerId)) throw new Error('图层或所属文件夹已锁定')
    projectEdits.execute(new SetLayerOpacityCommand(createId('cmd'), layerId, layer.opacity, next, transactionId))
  },

  setGroupVisible: (id, visible) => {
    if (typeof visible !== 'boolean') throw new Error('显隐值必须是布尔值')
    const state = useProjectStore.getState(), content = requireMapContent(state.project), group = content.groups.find(group => group.id === id)
    if (!group || group.visible === visible) return
    const project = { ...state.project, content: { ...content, groups: content.groups.map(item => item === group ? { ...group, visible } : item) } }
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '设置文件夹显隐', snapshotLayerTree(state.project), snapshotLayerTree(project)))
  },

  setGroupLocked: (id, locked) => {
    if (typeof locked !== 'boolean') throw new Error('锁定值必须是布尔值')
    const state = useProjectStore.getState(), content = requireMapContent(state.project), group = content.groups.find(group => group.id === id)
    if (!group) return
    if (!!group.locked === locked) return
    if (getLayerGroupState(state.project, group.parentId).locked) throw new Error('请先解锁父文件夹')
    const project = { ...state.project, content: { ...content, groups: content.groups.map(item => item === group ? { ...group, locked } : item) } }
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '设置文件夹锁定', snapshotLayerTree(state.project), snapshotLayerTree(project)))
  },

  renameLayer: (id, name) => {
    const state = useProjectStore.getState(), content = requireMapContent(state.project), layer = content.layers.find(layer => layer.id === id)
    if (!layer || !name.trim() || layer.name === name.trim()) return
    if (getEffectiveLocked(state.project, id)) throw new Error('父文件夹已锁定')
    const project = { ...state.project, content: { ...content, layers: content.layers.map(item => item === layer ? { ...layer, name: name.trim() } : item) } }
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '重命名图层', snapshotLayerTree(state.project), snapshotLayerTree(project)))
  },

  renameGroup: (id, name) => {
    const state = useProjectStore.getState(), content = requireMapContent(state.project), group = content.groups.find(group => group.id === id)
    if (!group || !name.trim() || group.name === name.trim()) return
    if (getLayerGroupState(state.project, id).locked) throw new Error('文件夹或其父级已锁定')
    const project = { ...state.project, content: { ...content, groups: content.groups.map(item => item === group ? { ...group, name: name.trim() } : item) } }
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '重命名文件夹', snapshotLayerTree(state.project), snapshotLayerTree(project)))
  },

  moveRootEntry: (entry, direction) => {
    const state = useProjectStore.getState(), project = normalizeLayerTree(state.project)
    const parent = entry.type === 'group' ? requireMapContent(project).groups.find(group => group.id === entry.id)?.parentId : findGroupForLayer(project, entry.id)?.id
    const siblings = getLayerTreeChildren(project, parent), index = siblings.findIndex(item => item.type === entry.type && item.id === entry.id)
    const target = index + (direction === 'up' ? -1 : 1)
    if (index < 0 || target < 0 || target >= siblings.length) return
    const after = moveLayerTreeEntry(project, entry, parent, target)
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '调整树对象顺序', snapshotLayerTree(project), snapshotLayerTree(after),
      entry.type === 'layer' ? { layerIds: [entry.id] } : { groupIds: [entry.id] }))
  },

  moveLayer: (id, direction) => layerConfigurationCommands.moveRootEntry({ type: 'layer', id }, direction),

  relocateGroup: (id, parentId, index) => {
    const state = useProjectStore.getState(), after = moveLayerTreeEntry(state.project, { type: 'group', id }, parentId, index)
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '移动文件夹', snapshotLayerTree(state.project), snapshotLayerTree(after), { groupIds: [id, ...(parentId ? [parentId] : [])] }))
  },

  createGroup: (name = '新建组', ids = [], parentId) => {
    const state = useProjectStore.getState(), before = normalizeLayerTree(state.project)
    if (getLayerGroupState(before, parentId).locked) throw new Error('目标文件夹或其父级已锁定')
    const group = createLayerGroup(name.trim() || '新建文件夹')
    let after = normalizeLayerTree({ ...before, content: { ...requireMapContent(before), groups: [...requireMapContent(before).groups, group] } })
    after = moveLayerTreeEntry(after, { type: 'group', id: group.id }, parentId, 0)
    for (const id of ids) if (requireMapContent(before).layers.some(layer => layer.id === id)) after = moveLayerTreeEntry(after, { type: 'layer', id }, group.id)
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '创建文件夹', snapshotLayerTree(before), snapshotLayerTree(after), { layerIds: ids, groupIds: parentId ? [parentId] : [] }))
    return group.id
  },

  relocateLayer: (id, target) => {
    const state = useProjectStore.getState(), after = moveLayerTreeEntry(state.project, { type: 'layer', id }, target.kind === 'group' ? target.groupId : undefined, target.index)
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '移动图层', snapshotLayerTree(state.project), snapshotLayerTree(after),
      { layerIds: [id], groupIds: target.kind === 'group' ? [target.groupId] : [] }))
  },

  addLayersToGroup: (groupId, ids) => {
    const state = useProjectStore.getState()
    let after = state.project
    for (const id of ids) after = moveLayerTreeEntry(after, { type: 'layer', id }, groupId)
    projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '移动图层到文件夹', snapshotLayerTree(state.project), snapshotLayerTree(after), { layerIds: ids, groupIds: [groupId] }))
  }
}
