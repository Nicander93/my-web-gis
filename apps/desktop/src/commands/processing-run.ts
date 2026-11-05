import { layerContentCommands } from '@/commands/layer-content.commands'
import { featureData } from '@/project/datasets/feature-data'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { requireMapContent } from '@desktop-webgis/project'
import { applyFieldFilter, capabilitiesForDataset, inferLayerStyleKind, type GisFeature, type Layer, type SelectionState, type ProcessingOptions, type ProcessingResult, type ProcessingRecord } from '@desktop-webgis/project'
import { useProjectStore } from '@/project/project.store'
import { runLoggedTask } from '@/stores/task-log'

export type ProcessingScope = 'all' | 'filtered' | 'selected'

export function resolveProcessingInput(layer: Layer, scope: ProcessingScope, all: GisFeature[], selection: SelectionState): GisFeature[] {
  if (scope === 'all') return all
  const filtered = applyFieldFilter(all, layer.filter)
  if (scope === 'filtered') return filtered
  const ids = new Set(selection.layerId === layer.id ? selection.featureIds : [])
  return filtered.filter(feature => ids.has(feature.id))
}

/** 解析出与地图和属性表一致的图层过滤和选择语义。 */
export function processingInput(layerId: string, scope: ProcessingScope): GisFeature[] {
  const state = useProjectStore.getState(), stateFeatureData = featureData.readSnapshot()
  const layer = requireMapContent(state.project).layers.find(item => item.id === layerId)
  const dataset = requireMapContent(state.project).datasets.find(item => item.id === layer?.datasetId)
  if (!layer || !capabilitiesForDataset(dataset).exportVector) throw new Error('请选择包含矢量数据的图层。')
  const all = stateFeatureData[layer.datasetId] ?? []
  return resolveProcessingInput(layer, scope, all, useLayerViewStore.getState().selection)
}

/** 每个任务单独开一个 worker，取消时可以真正停止计算并释放内存。 */
export function runProcessing(features: GisFeature[], options: ProcessingOptions, signal: AbortSignal, overlay: GisFeature[] = []): Promise<ProcessingResult> {
  return runProcessingWorker<ProcessingResult>({ features, options, overlay }, signal)
}

/** 只读报告和产出结果的运算共用同一套 worker 生命周期。 */
export function runProcessingWorker<T>(request: unknown, signal: AbortSignal): Promise<T> {
  const check = !!request && typeof request === 'object' && 'kind' in request && request.kind === 'check-geometry'
  return runLoggedTask(check ? '检查几何' : '空间处理', operation => executeProcessingWorker<T>(request, operation), signal, result => {
    const detail = result && typeof result === 'object' && 'issues' in result && Array.isArray(result.issues) ? `检查完成，发现 ${result.issues.length} 项问题`
      : result && typeof result === 'object' && 'features' in result && Array.isArray(result.features) ? `处理完成，生成 ${result.features.length} 个要素，等待添加结果` : '处理完成'
    return { detail }
  })
}

function executeProcessingWorker<T>(request: unknown, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    const worker = new Worker(new URL('@/ui/panels/processing/processing.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => {
      worker.terminate()
      worker.onmessage = null
      worker.onerror = null
      signal.removeEventListener('abort', cancel)
    }
    const cancel = () => { cleanup(); reject(new DOMException('已取消', 'AbortError')) }
    signal.addEventListener('abort', cancel, { once: true })
    worker.onmessage = event => {
      cleanup()
      if (event.data.error) reject(new Error(event.data.error))
      else resolve(event.data.result)
    }
    worker.onerror = () => { cleanup(); reject(new Error('处理程序未能运行，请重试。')) }
    try {
      worker.postMessage(request)
    } catch {
      cleanup()
      reject(new Error('输入数据无法传递给处理程序。'))
    }
  })
}

/** 只把完成的结果提交回发起它的项目，并作为一个独立的本地图层。 */
export function addProcessingResult(projectId: string, name: string, result: ProcessingResult, record?: ProcessingRecord): string {
  const state = useProjectStore.getState()
  if (state.project.metadata.id !== projectId) throw new Error('项目已切换，本次结果未添加。')
  if (!name.trim()) throw new Error('请输入结果图层名称。')
  if (!result.features.length) throw new Error('处理结果为空，未添加图层。')
  const copied = layerContentCommands.copyFeaturesToLocalLayer(result.features, name.trim(), inferLayerStyleKind(result.features), record)
  if (!copied) throw new Error('未能创建结果图层。')
  return copied.layerId
}
