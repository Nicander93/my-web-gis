import { cloneValue, requiresOverlay, type ProcessingOptions, type ProcessingRecord } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { addProcessingResult, processingInput, runProcessing, type ProcessingScope } from '@/services/processing'

let openProcessingDialog: (() => void) | null = null

interface ProcessingRequest {
  layerId: string
  scope: ProcessingScope
  options: ProcessingOptions
  name: string
  signal: AbortSignal
  overlay?: { layerId: string; scope: ProcessingScope }
}

export function registerProcessingDialog(callback: (() => void) | null): void {
  openProcessingDialog = callback
}

export const processingCommands = {
  open(): void { openProcessingDialog?.() },

  /** Snapshot input and commit only after successful, uncancelled computation. */
  async run(args: ProcessingRequest): Promise<{ layerId: string; inputCount: number; outputCount: number }> {
    const projectId = useProjectStore.getState().project.id
    const sourceLayer = useProjectStore.getState().project.layers.find(layer => layer.id === args.layerId)
    if (!args.name.trim()) throw new Error('请输入结果图层名称。')
    const input = processingInput(args.layerId, args.scope)
    if (!input.length) throw new Error('当前处理范围没有要素。')
    const options = cloneValue(args.options)
    let overlayFeatures = [] as typeof input
    let overlayRecord: ProcessingRecord['overlay']
    if (requiresOverlay(options.tool)) {
      if (!args.overlay) throw new Error('请选择第二输入图层。')
      const overlayLayer = useProjectStore.getState().project.layers.find(layer => layer.id === args.overlay?.layerId)
      overlayFeatures = processingInput(args.overlay.layerId, args.overlay.scope)
      if (!overlayFeatures.length && options.tool !== 'summarize-location' && options.tool !== 'attribute-join' && options.tool !== 'spatial-join') throw new Error('第二输入范围没有要素。')
      overlayRecord = { layerId: args.overlay.layerId, layerName: overlayLayer?.name ?? '', scope: args.overlay.scope, inputCount: overlayFeatures.length }
    }
    const result = await runProcessing(input, options, args.signal, overlayFeatures)
    if (args.signal.aborted) throw new DOMException('已取消', 'AbortError')
    if (!result.features.length) throw new Error(options.tool === 'attribute-join' || options.tool === 'spatial-join'
      ? '没有匹配的连接记录，未创建图层。请检查连接键或选择保留全部输入。'
      : options.tool === 'extract-location'
      ? '没有符合空间关系的要素，未创建图层。请检查输入范围或调整关系。'
      : '没有符合条件的面结果，未创建图层。请检查两层范围；仅边界接触不生成面。')
    const layerId = addProcessingResult(projectId, args.name, result, {
      options, sourceLayerId: args.layerId, sourceLayerName: sourceLayer?.name ?? '', overlay: overlayRecord,
      scope: args.scope, inputCount: result.inputCount, outputCount: result.features.length, completedAt: new Date().toISOString()
    })
    return { layerId, inputCount: result.inputCount, outputCount: result.features.length }
  }
}
