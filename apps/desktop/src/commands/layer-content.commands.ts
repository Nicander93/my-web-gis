import { AddDatasetLayerCommand, cloneValue, createDefaultLayerStyle, createId, dissolveLayerGroup, getEffectiveLocked, getLayerGroupState, normalizeLayerTree,
  reconcileProjectCartography, RemoveLayerContentCommand, requireMapContent, SetLayerTreeCommand, snapshotLayerTree,
  type Dataset, type DatasetKind, type EditCommand, type GisFeature, type Layer, type ProcessingRecord, type Project, type ProjectEditContext, type ServiceSource } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { featureData } from '@/project/datasets/feature-data'
import { projectEdits } from '@/project/project-edits'

type StyleKind = 'point' | 'line' | 'polygon' | 'mixed'

/** 图层和数据集的增删属于应用级操作，统一记录在同一条编辑历史里。 */
export const layerContentCommands = {
  addLayer(datasetId: string, name: string, features: GisFeature[], styleKind: StyleKind, processing?: ProcessingRecord): void {
    addLocalLayer(datasetId, name, features, styleKind, processing)
  },

  copyFeaturesToLocalLayer(features: GisFeature[], name: string, styleKind: StyleKind, processing?: ProcessingRecord): { datasetId: string; layerId: string } | null {
    if (features.length === 0) return null
    return addLocalLayer(createId('dataset'), name, features, styleKind, processing, true)
  },

  addServiceLayer(input: { name: string; kind: Exclude<DatasetKind, 'vector'>; source: ServiceSource }): { datasetId: string; layerId: string } | null {
    if (!input.name.trim() || input.kind !== input.source.type) return null
    const dataset = { id: createId('dataset'), name: input.name, kind: input.kind, source: cloneValue(input.source) } as Dataset
    return addDatasetLayer(dataset, createDefaultLayerStyle('mixed'))
  },

  removeLayer(layerId: string): boolean {
    const project = useProjectStore.getState().project
    if (!requireMapContent(project).layers.some(layer => layer.id === layerId)) return false
    return removeContent(project, new Set([layerId]), new Set(), '删除图层')
  },

  removeGroup(groupId: string, removeChildren: boolean): boolean {
    const project = useProjectStore.getState().project, content = requireMapContent(project)
    if (!content.groups.some(group => group.id === groupId)) return false
    if (!removeChildren) {
      const after = dissolveLayerGroup(project, groupId)
      return projectEdits.execute(new SetLayerTreeCommand(createId('cmd'), '解散文件夹', snapshotLayerTree(project), snapshotLayerTree(after)))
    }
    const groups = new Set([groupId])
    for (let changed = true; changed;) {
      changed = false
      for (const group of content.groups) {
        if (group.parentId && groups.has(group.parentId) && !groups.has(group.id)) { groups.add(group.id); changed = true }
      }
    }
    const layers = new Set(content.groups.filter(group => groups.has(group.id)).flatMap(group => group.layerIds))
    return removeContent(project, layers, groups, '删除文件夹及其内容')
  }
}

function addLocalLayer(datasetId: string, name: string, features: GisFeature[], styleKind: StyleKind, processing?: ProcessingRecord, clearSelection = false) {
  const dataset: Extract<Dataset, { kind: 'vector' }> = { id: datasetId, name, kind: 'vector', source: { type: 'memory', label: name },
    ...(processing ? { processing: cloneValue(processing) } : {}) }
  return addDatasetLayer(dataset, createDefaultLayerStyle(styleKind), features, clearSelection)
}

function addDatasetLayer(dataset: Dataset, style: Layer['style'], features?: GisFeature[], clearSelection = false): { datasetId: string; layerId: string } {
  const layer: Layer = { id: createId('layer'), datasetId: dataset.id, name: dataset.name, visible: true, opacity: 1, editable: false, style, filter: [] }
  const session = useLayerViewStore.getState(), previousLayerId = session.selectedLayerId, previousSelection = cloneValue(session.selection)
  const previousCount = session.lastSelectionCountAfterFilter
  function withSelection(command: AddDatasetLayerCommand): EditCommand { return { id: command.id, label: command.label, targets: command.targets,
    rebaseDatasetLifecycleCommit(datasetId, rows, fields, references) {
      const next = command.rebaseDatasetLifecycleCommit(datasetId, rows, fields, references)
      return next === command ? this : withSelection(next)
    },
    execute(context: ProjectEditContext) {
      command.execute(context)
      context.afterCommit?.(() => useLayerViewStore.setState({ selectedLayerId: layer.id,
        ...(clearSelection ? { selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: null } : {}) }))
    },
    undo(context: ProjectEditContext) {
      command.undo(context)
      context.afterCommit?.(() => {
        const layers = requireMapContent(useProjectStore.getState().project).layers
        const selectionExists = layers.some(item => item.id === previousSelection.layerId)
        useLayerViewStore.setState({ selectedLayerId: layers.some(item => item.id === previousLayerId) ? previousLayerId : null,
          selection: selectionExists ? cloneValue(previousSelection) : { layerId: null, featureIds: [] },
          lastSelectionCountAfterFilter: selectionExists ? previousCount : null })
      })
    }
  } }
  projectEdits.execute(withSelection(new AddDatasetLayerCommand(createId('cmd'), dataset, layer, features, features === undefined ? '添加服务图层' : '添加结果图层')))
  return { datasetId: dataset.id, layerId: layer.id }
}

function removeContent(project: Project, layerIds: Set<string>, groupIds: Set<string>, label: string): boolean {
  if ([...layerIds].some(id => getEffectiveLocked(project, id)) || [...groupIds].some(id => getLayerGroupState(project, id).locked)) {
    throw new Error('请先解锁图层、文件夹及其后代')
  }
  const content = requireMapContent(project)
  const layers = content.layers.filter(layer => !layerIds.has(layer.id))
  const candidates = new Set(content.layers.filter(layer => layerIds.has(layer.id)).map(layer => layer.datasetId))
  const retainedDatasets = new Set(layers.map(layer => layer.datasetId))
  const orphaned = new Set([...candidates].filter(id => !retainedDatasets.has(id)))
  const after = reconcileProjectCartography(normalizeLayerTree({ ...project, content: { ...content, layers,
    datasets: content.datasets.filter(dataset => !orphaned.has(dataset.id)),
    groups: content.groups.filter(group => !groupIds.has(group.id)),
    rootOrder: content.rootOrder.filter(entry => !(entry.type === 'layer' ? layerIds : groupIds).has(entry.id))
  } }), project)
  const rows = Object.fromEntries(featureData.getDatasetIds().filter(id => orphaned.has(id)).map(id => [id, featureData.getAll(id)]))
  return projectEdits.execute(new RemoveLayerContentCommand(createId('cmd'), label, project, after, rows))
}
