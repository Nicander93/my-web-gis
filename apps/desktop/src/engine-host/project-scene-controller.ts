import { projectSession } from '@/project/project-session'
import { projectConfiguration } from '@/project/project-configuration'
import { getLayerTreeChildren, requireMapContent } from '@desktop-webgis/project'
import { createHostedSceneController, type SceneController } from '@desktop-webgis/scene-core'
import type { EditTargets, ProjectSnapshot } from '@desktop-webgis/project'
import type { SceneCommitIntent } from '@desktop-webgis/scene-core'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import { useProjectStore } from '@/project/project.store'
import { featureData } from '@/project/datasets/feature-data'
import { createProjectFromSceneDocument, createProjectSceneDocument, createProjectSceneProjection } from '@/io/project-scene-document'

function sameDefinition(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameDefinition(value, right[index]))
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) &&
    sameDefinition((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}

/** 可移植的编辑不能丢掉未发生变化的宿主专有来源、处理记录和设置。 */
function prepareProjectEdit(before: ProjectSnapshot, next: SceneDocument): ProjectSnapshot {
  const candidate = createProjectFromSceneDocument(next)
  if (candidate.project.content.kind !== before.project.content.kind) throw new Error('内容编辑不能切换工作区，请先新建对应类型的工程')
  if (candidate.project.metadata.id !== before.project.metadata.id) return candidate
  const projection = createProjectSceneProjection(before), previous = projection.document
  const scene = candidate.project.content.scene
  if (scene) {
    // 已有的宿主身份优先；只给与恢复身份冲突的项分配新 ID。
    const nodeIds = restoreHostIds([...(scene.groups ?? []).map(group => group.id), ...scene.nodes.map(node => node.id)], projection.hostSceneNodeIds)
    const resourceIds = restoreHostIds(Object.keys(scene.assets), projection.hostSceneResourceIds)
    scene.groups = scene.groups?.map(group => ({ ...group, id: nodeIds.get(group.id)!, ...(group.parentId ? { parentId: nodeIds.get(group.parentId)! } : {}) }))
    scene.nodes = scene.nodes.map(node => ({ ...node, id: nodeIds.get(node.id)!,
      ...('asset' in node ? { asset: resourceIds.get(node.asset)! } : {}), ...(node.groupId ? { groupId: nodeIds.get(node.groupId)! } : {}) }))
    scene.assets = Object.fromEntries(Object.entries(scene.assets).map(([id, asset]) => [resourceIds.get(id)!, asset]))
  }
  candidate.project.content.settings = { ...structuredClone(before.project.content.settings), ...candidate.project.content.settings }
  if (candidate.project.content.kind === 'scene3d') return candidate
  requireMapContent(candidate.project).datasets = requireMapContent(candidate.project).datasets.map(dataset => {
    const existing = requireMapContent(before.project).datasets.find(entry => entry.id === dataset.id)
    if (!existing || !sameDefinition(previous.resources[dataset.id], next.resources[dataset.id])) return dataset
    if (before.featuresByDataset[dataset.id]) candidate.featuresByDataset[dataset.id] = structuredClone(before.featuresByDataset[dataset.id])
    return structuredClone(existing)
  })
  requireMapContent(candidate.project).layers = requireMapContent(candidate.project).layers.map(layer => {
    const existing = requireMapContent(before.project).layers.find(entry => entry.id === layer.id)
    const previousNode = previous.nodes.find(node => node.id === layer.id), nextNode = next.nodes.find(node => node.id === layer.id)
    const retained = existing ? { ...layer, editable: existing.editable } : layer
    return existing && (previousNode?.type === 'tile' && nextNode?.type === 'tile' || previousNode?.type === 'vector' && nextNode?.type === 'vector' && sameDefinition(previousNode.style, nextNode.style))
      ? { ...retained, style: structuredClone(existing.style) } : retained
  })
  requireMapContent(candidate.project).groups = requireMapContent(candidate.project).groups.map(group => {
    const existing = requireMapContent(before.project).groups.find(item => item.id === group.id)
    if (!existing || !sameDefinition(getLayerTreeChildren(before.project, group.id), getLayerTreeChildren(candidate.project, group.id))) return group
    const retained = { ...group }
    if (existing.childOrder) retained.childOrder = structuredClone(existing.childOrder)
    else delete retained.childOrder
    return retained
  })
  const oldBase = previous.nodes.find(node => node.type === 'tile' && node.role === 'basemap')
  const newBase = next.nodes.find(node => node.type === 'tile' && node.role === 'basemap')
  if (oldBase?.type === 'tile' && newBase?.type === 'tile' && sameDefinition(oldBase, newBase) &&
      sameDefinition(previous.resources[oldBase.resource], next.resources[newBase.resource])) {
    requireMapContent(candidate.project).basemap = structuredClone(requireMapContent(before.project).basemap)
  }
  return candidate
}

function restoreHostIds(ids: readonly string[], aliases: ReadonlyMap<string, string>): Map<string, string> {
  const restored = new Map<string, string>(), used = new Set<string>()
  for (const id of ids) {
    const hostId = aliases.get(id)
    if (hostId !== undefined) { restored.set(id, hostId); used.add(hostId) }
  }
  for (const id of ids) {
    if (restored.has(id)) continue
    let hostId = id, suffix = 2
    while (used.has(hostId)) hostId = `${id}-${suffix++}`
    restored.set(id, hostId); used.add(hostId)
  }
  return restored
}

/** 配置提交不改动行的归属；资源变更仍然走数据与会话的生命周期。 */
function isConfigurationEdit(before: ProjectSnapshot, after: ProjectSnapshot): boolean {
  if (before.project.metadata.id !== after.project.metadata.id || before.project.content.kind !== after.project.content.kind) return false
  if (!sameDefinition(before.featuresByDataset, after.featuresByDataset)) return false
  if (before.project.content.kind === 'scene3d') return true
  if (after.project.content.kind !== 'map2d') return false
  if (!sameDefinition(before.project.content.datasets, after.project.content.datasets)) return false
  const bindings = new Map(after.project.content.layers.map(layer => [layer.id, layer.datasetId]))
  return before.project.content.layers.length === bindings.size && before.project.content.layers.every(layer => bindings.get(layer.id) === layer.datasetId)
}

/** 精确保留移动前后的身份对应；对不透明事务，保守地保护被挤开的同级项。 */
function orderTargets(before: ProjectSnapshot, next: SceneDocument, intent?: SceneCommitIntent): EditTargets {
  const projection = createProjectSceneProjection(before), previous = projection.document
  const ids = new Set<string>()
  if (intent) {
    ids.add(intent.move.id)
    const parent = previous.nodes.find(node => node.id === intent.move.id)?.parentId
    if (parent) ids.add(parent)
    if (intent.move.parentId) ids.add(intent.move.parentId)
  } else {
    const parents = new Set([...previous.nodes, ...next.nodes].map(node => node.parentId))
    for (const parent of parents) {
      const a = previous.nodes.filter(node => node.parentId === parent).map(node => node.id)
      const positions = new Map(next.nodes.filter(node => node.parentId === parent).map((node, index) => [node.id, index]))
      for (const [index, id] of a.entries()) if (positions.has(id) && positions.get(id) !== index) ids.add(id)
    }
  }
  const groups = new Set(previous.nodes.filter(node => node.type === 'group').map(node => node.id))
  if (before.project.content.kind === 'map2d') return {
    layerIds: [...ids].filter(id => before.project.content.kind === 'map2d' && before.project.content.layers.some(layer => layer.id === id)),
    groupIds: [...ids].filter(id => groups.has(id))
  }
  return {
    sceneNodeIds: [...ids].filter(id => !groups.has(id)).map(id => projection.hostSceneNodeIds.get(id) ?? id),
    sceneGroupIds: [...ids].filter(id => groups.has(id)).map(id => projection.hostSceneNodeIds.get(id) ?? id)
  }
}

/** 把公开的场景 API 挂到已有的 Project 和共享的编辑历史上，不额外维护一份内容副本。 */
export function createProjectSceneController(): SceneController {
  return createHostedSceneController({
    read: () => createProjectSceneDocument(projectSession.getSnapshot()),
    commit(document, label, intent) {
      const before = projectSession.getSnapshot()
      const candidate = prepareProjectEdit(before, document)
      if (sameDefinition(before, candidate)) return
      if (isConfigurationEdit(before, candidate)) projectConfiguration.apply(candidate.project, label, orderTargets(before, document, intent))
      else if (candidate.project.metadata.id === before.project.metadata.id) projectSession.applySnapshotAsEdit(candidate, label)
      else projectSession.replaceSnapshotAsEdit(candidate, label)
    },
    subscribe(observer) {
      let previous = { project: useProjectStore.getState().project, featuresByDataset: featureData.readSnapshot() }
      const notify = () => {
        const current = { project: useProjectStore.getState().project, featuresByDataset: featureData.readSnapshot() }
        if (current.project === previous.project && current.featuresByDataset === previous.featuresByDataset) return
        const before = previous; previous = current
        observer({ label: 'Project content change',
          before: createProjectSceneDocument(before), after: createProjectSceneDocument(current) })
      }
      const unsubscribeProject = useProjectStore.subscribe(notify), unsubscribeData = featureData.subscribe(notify)
      return () => { unsubscribeProject(); unsubscribeData() }
    }
  })
}
