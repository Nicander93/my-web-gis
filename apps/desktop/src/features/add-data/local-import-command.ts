import { ApplyProjectSnapshotEditCommand, cloneValue, createDefaultLayerStyle, createId,
  type EditContext, type ProjectSnapshot } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import type { ImportResult } from '@/services/import'
import { useTaskLogStore } from '@/stores/task-log.store'

/** Validate the complete selection before constructing one same-project content transaction. */
export function prepareLocalImport(before: ProjectSnapshot, result: ImportResult): ProjectSnapshot {
  if (result.errors.length) throw new Error(result.errors.join('；'))
  if (!result.layers.length) throw new Error('没有可导入的图层')
  for (const layer of result.layers) {
    if (!layer.name.trim()) throw new Error('导入图层名称不能为空')
    const ids = new Set<string>()
    for (const feature of layer.features) {
      if (!feature.id || ids.has(feature.id)) throw new Error(`图层 ${layer.name} 的要素 ID 缺失或重复`)
      if (!feature.geometry || !feature.properties || typeof feature.properties !== 'object' || Array.isArray(feature.properties))
        throw new Error(`图层 ${layer.name} 的要素 ${feature.id} 缺少几何或属性对象`)
      ids.add(feature.id)
    }
  }
  // Clone the whole input before any Store mutation; imported records never alias preview data.
  const after = cloneValue(before), layers = cloneValue(result.layers)
  for (const input of layers) {
    const datasetId = createId('dataset'), layerId = createId('layer')
    after.project.datasets.push({ id: datasetId, name: input.name, kind: 'vector', source: { type: 'memory', label: input.name } })
    after.project.layers.push({ id: layerId, datasetId, name: input.name, visible: true, opacity: 1,
      editable: false, style: createDefaultLayerStyle(input.styleKind), filter: [] })
    after.project.rootOrder = [...(after.project.rootOrder ?? []), { type: 'layer', id: layerId }]
    after.featuresByDataset[datasetId] = input.features
  }
  return after
}

class ImportLocalLayersCommand extends ApplyProjectSnapshotEditCommand {
  constructor(before: ProjectSnapshot, after: ProjectSnapshot, private readonly previousLayerId: string | null) {
    super(createId('cmd'), `导入 ${after.project.layers.length - before.project.layers.length} 个图层`, before, after)
  }
  override execute(context: EditContext): void {
    super.execute(context)
    useProjectStore.getState().setSelectedLayer(this.after.project.layers.at(-1)?.id ?? null)
  }
  override undo(context: EditContext): void {
    super.undo(context)
    const state = useProjectStore.getState()
    state.setSelectedLayer(state.project.layers.some((layer) => layer.id === this.previousLayerId) ? this.previousLayerId : null)
  }
}

/** Local GeoJSON/SHP/DXF/CSV confirmation shares one history item for all chosen layers. */
export function commitLocalImport(result: ImportResult): void {
  const state = useProjectStore.getState()
  const before = state.getSnapshot(), after = prepareLocalImport(before, result)
  state.executeEditCommand(new ImportLocalLayersCommand(before, after, state.selectedLayerId))
  const logs = useTaskLogStore.getState()
  const task = logs.start(state.projectEpoch, '导入数据')
  logs.finish(task, 'succeeded', `已导入 ${result.layers.length} 个图层、${result.layers.reduce((sum, layer) => sum + layer.features.length, 0)} 个要素，可撤销。`)
}
