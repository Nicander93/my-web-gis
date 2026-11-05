import { datasetConfigurationCommands } from '@/commands/dataset-configuration.commands'
import { featureCommands } from '@/commands/feature.commands'
import { featureData } from '@/project/datasets/feature-data'
import { requireMapContent } from '@desktop-webgis/project'
import { emitCommandStatus } from '@/platform/command-status'
import { useProjectStore } from '@/project/project.store'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { loadWfsBoundedSnapshot } from '@/io/wfs-load'
import { parseWfsGmlFeatures } from '@desktop-webgis/ol-runtime'
import type { ServiceDescription } from '@desktop-webgis/ogc-io'
import type { ResolveWfsSelection } from '@desktop-webgis/ogc-io'
import type { WfsServiceSource } from '@desktop-webgis/project'

export interface StartWfsLoadInput {
  layerId: string
  datasetId: string
  description: ServiceDescription
  selection: ResolveWfsSelection
  authMode: 'none' | 'query-token' | 'bearer'
  tokenParam?: string
  credentialRefKey?: string
  /** 为 true 时表示这是一次刷新，失败要保留原有的要素。 */
  isRefresh?: boolean
}

/**
 * 开始一次有界的 WFS 快照加载。取消、删除图层、切换项目时都能安全处理。
 * 刷新失败时保留上一份快照。
 */
export async function startWfsBoundedLoad(input: StartWfsLoadInput): Promise<void> {
  const session = useLayerViewStore.getState()
  const loadGeneration = session.wfsLoadGeneration
  const loadToken = `${loadGeneration}:${input.layerId}:${Date.now()}`

  // 先中止这个图层上之前的加载。
  session.abortWfsLoad(input.layerId)
  const controller = new AbortController()
  session.setWfsAbort(input.layerId, controller)
  session.setLayerLoading(input.layerId, true)

  const previousFeatures = featureData.readSnapshot()[input.datasetId] ?? []

  try {
    const result = await loadWfsBoundedSnapshot({
      description: input.description,
      selection: input.selection,
      authMode: input.authMode,
      tokenParam: input.tokenParam,
      credentialRefKey: input.credentialRefKey,
      signal: controller.signal,
      loadToken,
      parseGml: (body, opts) => parseWfsGmlFeatures(body, opts)
    })

    // 编辑资源时可能替换掉同 ID 的图层，但不会切换整个项目。
    if (controller.signal.aborted || useLayerViewStore.getState().wfsAbortByLayer[input.layerId] !== controller) return
    // 项目已切换或图层已被删除时视为过期。
    if (useLayerViewStore.getState().wfsLoadGeneration !== loadGeneration) {
      return
    }
    const project = useProjectStore.getState().project
    const layerStillThere = requireMapContent(project).layers.some((l) => l.id === input.layerId)
    const datasetStillThere = requireMapContent(project).datasets.some((d) => d.id === input.datasetId)
    if (!layerStillThere || !datasetStillThere) {
      return
    }

    if (!result.ok) {
      if (result.code === 'cancelled') {
        emitCommandStatus('已取消 WFS 加载')
        return
      }
      if (input.isRefresh) {
        // 刷新失败时保留上一份快照。
        emitCommandStatus(`WFS 刷新失败，已保留原快照：${result.message}`)
        return
      }
      // 首次加载只拿到部分分页时，把这些部分结果作为不完整快照应用。
      if (result.partial) {
        applySnapshot(input.datasetId, result.partial.features, {
          loadedCount: result.partial.loadedCount,
          complete: false,
          truncatedByLimit: false,
          duplicateIdCount: result.partial.duplicateIdCount,
          paginationUsed: result.partial.paginationUsed,
          queryExtentWgs84: result.partial.resolved.queryExtentWgs84,
          extentMode: result.partial.resolved.extentMode,
          outputFormat: result.partial.resolved.outputFormat.value,
          srsName: result.partial.resolved.srsName,
          maxFeatures: result.partial.resolved.maxFeatures,
          lastLoadedAt: new Date().toISOString()
        })
        emitCommandStatus(
          `WFS 后续页失败，已加载 ${result.partial.loadedCount} 个要素（不完整）：${result.message}`
        )
        return
      }
      emitCommandStatus(`WFS 加载失败：${result.message}`)
      return
    }

    applySnapshot(input.datasetId, result.features, {
      loadedCount: result.loadedCount,
      complete: result.complete,
      truncatedByLimit: result.truncatedByLimit,
      duplicateIdCount: result.duplicateIdCount,
      paginationUsed: result.paginationUsed,
      queryExtentWgs84: result.resolved.queryExtentWgs84,
      extentMode: result.resolved.extentMode,
      outputFormat: result.resolved.outputFormat.value,
      srsName: result.resolved.srsName,
      maxFeatures: result.resolved.maxFeatures,
      lastLoadedAt: result.lastLoadedAt
    })

    const trunc = result.truncatedByLimit
      ? `（已达上限 ${result.resolved.maxFeatures}，结果不完整）`
      : result.complete
        ? '（完整）'
        : '（不完整）'
    const dup =
      result.duplicateIdCount > 0 ? `，去重 ${result.duplicateIdCount}` : ''
    emitCommandStatus(`WFS 快照已加载 ${result.loadedCount} 个要素${trunc}${dup}`)
  } finally {
    if (useLayerViewStore.getState().wfsAbortByLayer[input.layerId] === controller) {
      useLayerViewStore.getState().setLayerLoading(input.layerId, false)
      useLayerViewStore.getState().setWfsAbort(input.layerId, null)
    }
    // Silence unused previousFeatures when refresh succeeded — kept for clarity.
    void previousFeatures
  }
}

function applySnapshot(
  datasetId: string,
  features: import('@desktop-webgis/project').GisFeature[],
  meta: Partial<WfsServiceSource>
): void {
  const store = useProjectStore.getState()
  featureCommands.replaceDatasetFeatures(datasetId, features)
  datasetConfigurationCommands.patchWfsServiceSource(datasetId, meta)
}

/** 用已保存的数据源和上次已知的 Capabilities 选择，刷新已有的 WFS 图层快照。 */
export async function refreshWfsLayer(layerId: string): Promise<void> {
  const state = useProjectStore.getState()
  const layer = requireMapContent(state.project).layers.find((l) => l.id === layerId)
  if (!layer) {
    emitCommandStatus('图层不存在')
    return
  }
  const dataset = requireMapContent(state.project).datasets.find((d) => d.id === layer.datasetId)
  if (!dataset || dataset.kind !== 'wfs') {
    emitCommandStatus('仅 WFS 快照图层支持刷新')
    return
  }

  const source = dataset.source
  const viewExtent = useLayerViewStore.getState().mapViewExtentWgs84
  const extentMode = source.extentMode ?? 'view'

  // 用持久化的数据源重建最小的 ServiceDescription，不保留在线目录的完整内容。
  const description: ServiceDescription = {
    service: 'WFS',
    version: source.version,
    shareableUrl: source.url,
    layers: [
      {
        name: source.typeName,
        bboxWgs84: source.bboxWgs84,
        defaultCrs: source.srsName,
        crs: source.srsName ? [source.srsName] : undefined
      }
    ],
    featureTypes: [
      {
        name: source.typeName,
        bboxWgs84: source.bboxWgs84,
        defaultCrs: source.srsName,
        crs: source.srsName ? [source.srsName] : undefined
      }
    ],
    wfsOutputFormats: source.outputFormat ? [source.outputFormat] : undefined,
    wfsGetFeatureUrls: [source.url],
    wfsPaging: { supported: Boolean(source.paginationUsed) }
  }

  await startWfsBoundedLoad({
    layerId,
    datasetId: dataset.id,
    description,
    selection: {
      typeName: source.typeName,
      outputFormat: source.outputFormat,
      srsName: source.srsName,
      maxFeatures: source.maxFeatures,
      extentMode,
      viewExtentWgs84: extentMode === 'view' ? viewExtent : undefined
    },
    authMode: source.authMode,
    tokenParam: source.tokenParam,
    credentialRefKey: source.credentialRef?.key,
    isRefresh: true
  })
}
