import { createHostedSceneController, type SceneController } from '@desktop-webgis/scene-core'
import type { ProjectSnapshot } from '@desktop-webgis/gis-core'
import type { SceneDocument } from '@desktop-webgis/scene-schema'
import { useProjectStore } from '@/stores/project.store'
import { createProjectFromSceneDocument, createProjectSceneDocument } from './project-scene-document'

function sameDefinition(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameDefinition(value, right[index]))
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) &&
    sameDefinition((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}

/** Portable edits must not discard unchanged host-only origins, processing records or settings. */
function prepareProjectEdit(before: ProjectSnapshot, next: SceneDocument): ProjectSnapshot {
  const candidate = createProjectFromSceneDocument(next)
  if (candidate.project.id !== before.project.id) return candidate
  const previous = createProjectSceneDocument(before)
  candidate.project.settings = { ...structuredClone(before.project.settings), ...candidate.project.settings }
  if (previous.activeView === next.activeView && previous.views[previous.activeView]?.type === next.views[next.activeView]?.type) {
    if (Object.hasOwn(before.project.settings, 'workspaceType')) candidate.project.settings.workspaceType = structuredClone(before.project.settings.workspaceType)
    else delete candidate.project.settings.workspaceType
  }
  candidate.project.datasets = candidate.project.datasets.map(dataset => {
    const existing = before.project.datasets.find(entry => entry.id === dataset.id)
    if (!existing || !sameDefinition(previous.resources[dataset.id], next.resources[dataset.id])) return dataset
    if (before.featuresByDataset[dataset.id]) candidate.featuresByDataset[dataset.id] = structuredClone(before.featuresByDataset[dataset.id])
    return structuredClone(existing)
  })
  candidate.project.layers = candidate.project.layers.map(layer => {
    const existing = before.project.layers.find(entry => entry.id === layer.id)
    const previousNode = previous.nodes.find(node => node.id === layer.id), nextNode = next.nodes.find(node => node.id === layer.id)
    return existing && (previousNode?.type === 'tile' && nextNode?.type === 'tile' || previousNode?.type === 'vector' && nextNode?.type === 'vector' && sameDefinition(previousNode.style, nextNode.style))
      ? { ...layer, style: structuredClone(existing.style) } : layer
  })
  const oldBase = previous.nodes.find(node => node.type === 'tile' && node.role === 'basemap')
  const newBase = next.nodes.find(node => node.type === 'tile' && node.role === 'basemap')
  if (oldBase?.type === 'tile' && newBase?.type === 'tile' && sameDefinition(oldBase, newBase) &&
      sameDefinition(previous.resources[oldBase.resource], next.resources[newBase.resource])) {
    candidate.project.basemap = structuredClone(before.project.basemap)
  }
  return candidate
}

/** Attaches public scene APIs to the existing Project and shared edit history, without a content mirror. */
export function createProjectSceneController(): SceneController {
  return createHostedSceneController({
    read: () => createProjectSceneDocument(useProjectStore.getState().getSnapshot()),
    commit(document, label) {
      const state = useProjectStore.getState()
      const candidate = prepareProjectEdit(state.getSnapshot(), document)
      if (sameDefinition(state.getSnapshot(), candidate)) return
      if (candidate.project.id === state.project.id) state.applySnapshotAsEdit(candidate, label)
      else state.replaceSnapshotAsEdit(candidate, label)
    },
    subscribe(observer) {
      return useProjectStore.subscribe((state, previous) => {
        if (state.project === previous.project && state.featuresByDataset === previous.featuresByDataset) return
        observer({ label: 'Project content change',
          before: createProjectSceneDocument({ project: previous.project, featuresByDataset: previous.featuresByDataset }),
          after: createProjectSceneDocument({ project: state.project, featuresByDataset: state.featuresByDataset }) })
      })
    }
  })
}
