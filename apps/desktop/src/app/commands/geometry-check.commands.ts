import { cloneValue, type GisFeature } from '@desktop-webgis/gis-core'
import type { GeometryCheckReport, GeometryIssue } from '@desktop-webgis/spatial-analysis'
import { processingInput, runProcessingWorker, type ProcessingScope } from '@/services/processing'
import { useProjectStore } from '@/stores/project.store'
import { zoomMapToFeature } from '@/features/map/map-runtime-host'
import { emitCommandStatus } from './status'

export interface GeometryCheckResult {
  report: GeometryCheckReport
  projectId: string
  layerId: string
  datasetId: string
  source: GisFeature[]
}

function requireCurrent(result: GeometryCheckResult): void {
  const state = useProjectStore.getState()
  if (state.project.id !== result.projectId || !state.project.layers.some(layer => layer.id === result.layerId && layer.datasetId === result.datasetId) || state.featuresByDataset[result.datasetId] !== result.source) throw new Error('输入数据已变化，请重新检查。')
}

/** Diagnose a snapshot without adding datasets or modifying edit history. */
export async function checkLayerGeometry(layerId: string, scope: ProcessingScope, signal: AbortSignal): Promise<GeometryCheckResult> {
  const state = useProjectStore.getState()
  const input = processingInput(layerId, scope)
  if (!input.length) throw new Error('当前范围没有要素。')
  const layer = state.project.layers.find(item => item.id === layerId)!
  const target = { projectId: state.project.id, layerId, datasetId: layer.datasetId, source: state.featuresByDataset[layer.datasetId] }
  const report = await runProcessingWorker<GeometryCheckReport>({ kind: 'check-geometry', features: cloneValue(input) }, signal)
  if (signal.aborted) throw new DOMException('已取消', 'AbortError')
  const result = { ...target, report }
  requireCurrent(result)
  return result
}

/** Selection is transient; changing it never dirties the project. */
export function selectGeometryIssues(result: GeometryCheckResult, issue?: GeometryIssue): void {
  requireCurrent(result)
  const ids = issue ? [issue.featureId] : [...new Set(result.report.issues.map(row => row.featureId))]
  const state = useProjectStore.getState()
  state.setSelectedLayer(result.layerId)
  state.setSelection({ layerId: result.layerId, featureIds: ids })
  if (issue && !zoomMapToFeature(result.layerId, issue.featureId, issue.location)) emitCommandStatus('已选择问题要素；没有可用的位置或地图尚未就绪。')
}
