import { applyFieldFilter, intersectSelectionIds, requireMapContent } from '@desktop-webgis/project'
import { featureData } from '@/data/feature-data'
import {
  onDatasetFieldsChanged,
  onLayersRemoved,
  onProjectReplaced,
  onSelectionFilter,
  onSnapshotApplied
} from '@/session/session-events'
import { useLayerViewStore } from './layer-view.store'
import { useWorkbenchStore } from './workbench.store'

function resetProjectView() {
  useLayerViewStore.getState().bumpWfsLoadGeneration()
  useWorkbenchStore.getState().reset()
  useLayerViewStore.setState({ sessions: {}, inspectorTab: 'layer' })
  useLayerViewStore.getState().resetProjectSelection()
}

let bound = false
export function bindSessionViewSync() {
  if (bound) return
  bound = true
  onProjectReplaced(resetProjectView)
  onLayersRemoved(layerIds => {
    const session = useLayerViewStore.getState(), workbench = useWorkbenchStore.getState()
    for (const id of layerIds) { session.abortWfsLoad(id); session.clearLayerSession(id) }
    if (workbench.editLayerId && layerIds.includes(workbench.editLayerId)) workbench.setActiveTool('none')
    const selectedLayerId = layerIds.includes(session.selectedLayerId ?? '') ? null : session.selectedLayerId
    const removedSelection = layerIds.includes(session.selection.layerId ?? '')
    useLayerViewStore.setState({ selectedLayerId, ...(removedSelection ? { selection: { layerId: null, featureIds: [] }, lastSelectionCountAfterFilter: 0 } : {}) })
  })
  onDatasetFieldsChanged(({ datasetId, from, to, project }) => {
    const session = useLayerViewStore.getState()
    for (const layer of requireMapContent(project).layers.filter(item => item.datasetId === datasetId)) {
      const table = session.sessions[layer.id]?.attributeTable
      if (!table) continue
      const mapNames = (names: string[]) => names.flatMap(name => name === from ? to ? [to] : [] : [name])
      session.setAttributeTableState(layer.id, {
        sortField: to && table.sortField === from ? to : table.sortField,
        statsField: to && table.statsField === from ? to : table.statsField,
        fieldOrder: to ? mapNames(table.fieldOrder ?? []) : table.fieldOrder,
        hiddenFields: to ? mapNames(table.hiddenFields ?? []) : table.hiddenFields,
        columnWidths: to ? Object.fromEntries(Object.entries(table.columnWidths ?? {}).map(([name, width]) => [name === from ? to : name, width])) : table.columnWidths,
        ...(table.filterDraft ? { filterDraft: table.filterDraft.flatMap(condition => condition.field === from ? to ? [{ ...condition, field: to }] : [] : [condition]) } : {})
      })
    }
  })
  onSnapshotApplied(({ removedLayers, dataChangedLayers, project }) => {
    const session = useLayerViewStore.getState(), workbench = useWorkbenchStore.getState()
    const stale = new Set([...removedLayers, ...dataChangedLayers]), sessions = { ...session.sessions }
    for (const id of stale) { session.abortWfsLoad(id); delete sessions[id] }
    if (workbench.editLayerId && stale.has(workbench.editLayerId)) { workbench.setEditLayer(null); workbench.setActiveTool('none') }
    for (const id of removedLayers) workbench.clearLayer(id)
    const layers = project.content.kind === 'map2d' ? project.content.layers : []
    const selectedLayerId = layers.some(layer => layer.id === session.selectedLayerId) ? session.selectedLayerId : null
    const selected = layers.find(layer => layer.id === session.selection.layerId)
    const selection = selected ? { layerId: selected.id, featureIds: intersectSelectionIds(session.selection.featureIds,
      applyFieldFilter(featureData.readSnapshot()[selected.datasetId] ?? [], selected.filter)) } : { layerId: null, featureIds: [] }
    useLayerViewStore.setState({ sessions, selectedLayerId, selection, lastSelectionCountAfterFilter: selected ? selection.featureIds.length : null })
  })
  onSelectionFilter(({ project, before, scope }) => {
    const session = useLayerViewStore.getState(), selectedId = session.selection.layerId
    if (selectedId && project.content.kind === 'map2d') {
      const next = project.content.layers.find(layer => layer.id === selectedId)
      const previous = before.content.kind === 'map2d' ? before.content.layers.find(layer => layer.id === selectedId) : undefined
      if (scope === 'data' || JSON.stringify(previous?.filter ?? []) !== JSON.stringify(next?.filter ?? [])) {
        const featureIds = intersectSelectionIds(session.selection.featureIds, applyFieldFilter(next ? featureData.readSnapshot()[next.datasetId] ?? [] : [], next?.filter))
        session.setSelectionState({ layerId: selectedId, featureIds })
      }
    }
  })
}

bindSessionViewSync()
