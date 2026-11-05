import { featureData } from '@/project/datasets/feature-data'
import { selectionCommands } from '@/commands/selection.commands'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { requireMapContent } from '@desktop-webgis/project'
import { cloneValue, type GisFeature } from '@desktop-webgis/project'
import type { GeometryCheckReport, GeometryIssue } from '@desktop-webgis/spatial-analysis'
import { processingInput, runProcessingWorker, type ProcessingScope } from '@/commands/processing-run'
import { useProjectStore } from '@/project/project.store'
import { zoomMapToFeature } from '@/engine-host/map-runtime-host'
import { emitCommandStatus } from '@/platform/command-status'

export interface GeometryCheckResult {
  report: GeometryCheckReport
  projectId: string
  layerId: string
  datasetId: string
  source: GisFeature[]
}

function requireCurrent(result: GeometryCheckResult): void {
  const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
  if (state.project.metadata.id !== result.projectId || !requireMapContent(state.project).layers.some(layer => layer.id === result.layerId && layer.datasetId === result.datasetId) || stateFeatureData[result.datasetId] !== result.source) throw new Error('输入数据已变化，请重新检查。')
}

/** 只诊断快照本身，不新增数据集，也不改动编辑历史。 */
export async function checkLayerGeometry(layerId: string, scope: ProcessingScope, signal: AbortSignal): Promise<GeometryCheckResult> {
  const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
  const input = processingInput(layerId, scope)
  if (!input.length) throw new Error('当前范围没有要素。')
  const layer = requireMapContent(state.project).layers.find(item => item.id === layerId)!
  const target = { projectId: state.project.metadata.id, layerId, datasetId: layer.datasetId, source: stateFeatureData[layer.datasetId] }
  const report = await runProcessingWorker<GeometryCheckReport>({ kind: 'check-geometry', features: cloneValue(input) }, signal)
  if (signal.aborted) throw new DOMException('已取消', 'AbortError')
  const result = { ...target, report }
  requireCurrent(result)
  return result
}

/** 选择是临时的，改变选择不会把项目标记为有未保存修改。 */
export function selectGeometryIssues(result: GeometryCheckResult, issue?: GeometryIssue): void {
  requireCurrent(result)
  const ids = issue ? [issue.featureId] : [...new Set(result.report.issues.map(row => row.featureId))]
  const state = useProjectStore.getState()
  useLayerViewStore.getState().setSelectedLayer(result.layerId)
  selectionCommands.setSelection({ layerId: result.layerId, featureIds: ids })
  if (issue && !zoomMapToFeature(result.layerId, issue.featureId, issue.location)) emitCommandStatus('已选择问题要素；没有可用的位置或地图尚未就绪。')
}
