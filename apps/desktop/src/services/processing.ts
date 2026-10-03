import { applyFieldFilter, capabilitiesForDataset, inferLayerStyleKind, type GisFeature, type Layer, type SelectionState, type ProcessingOptions, type ProcessingResult, type ProcessingRecord } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'

export type ProcessingScope = 'all' | 'filtered' | 'selected'

export function resolveProcessingInput(layer: Layer, scope: ProcessingScope, all: GisFeature[], selection: SelectionState): GisFeature[] {
  if (scope === 'all') return all
  const filtered = applyFieldFilter(all, layer.filter)
  if (scope === 'filtered') return filtered
  const ids = new Set(selection.layerId === layer.id ? selection.featureIds : [])
  return filtered.filter(feature => ids.has(feature.id))
}

/** Resolve the same layer filter and selection semantics used by the map and table. */
export function processingInput(layerId: string, scope: ProcessingScope): GisFeature[] {
  const state = useProjectStore.getState()
  const layer = state.project.layers.find(item => item.id === layerId)
  const dataset = state.project.datasets.find(item => item.id === layer?.datasetId)
  if (!layer || !capabilitiesForDataset(dataset).exportVector) throw new Error('请选择包含矢量数据的图层。')
  const all = state.featuresByDataset[layer.datasetId] ?? []
  return resolveProcessingInput(layer, scope, all, state.selection)
}

/** A worker per operation lets cancellation stop computation and release its memory. */
export function runProcessing(features: GisFeature[], options: ProcessingOptions, signal: AbortSignal, overlay: GisFeature[] = []): Promise<ProcessingResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已取消', 'AbortError')); return }
    const worker = new Worker(new URL('../features/processing/processing.worker.ts', import.meta.url), { type: 'module' })
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
      worker.postMessage({ features, options, overlay })
    } catch {
      cleanup()
      reject(new Error('输入数据无法传递给处理程序。'))
    }
  })
}

/** Commit only a completed result to the originating project, as an independent local layer. */
export function addProcessingResult(projectId: string, name: string, result: ProcessingResult, record?: ProcessingRecord): string {
  const state = useProjectStore.getState()
  if (state.project.id !== projectId) throw new Error('项目已切换，本次结果未添加。')
  if (!name.trim()) throw new Error('请输入结果图层名称。')
  if (!result.features.length) throw new Error('处理结果为空，未添加图层。')
  const copied = state.copyFeaturesToLocalLayer(result.features, name.trim(), inferLayerStyleKind(result.features), record)
  if (!copied) throw new Error('未能创建结果图层。')
  return copied.layerId
}
