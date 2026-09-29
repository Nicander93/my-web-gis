import { emitCommandStatus } from '@/app/commands/status'
import { useProjectStore } from '@/stores/project.store'
import { useSessionStore } from '@/stores/session.store'
import { loadWfsBoundedSnapshot } from '@/services/wfs-load'
import { parseWfsGmlFeatures } from '@desktop-webgis/ol-runtime'
import type { ServiceDescription } from '@desktop-webgis/ogc-io'
import type { ResolveWfsSelection } from '@desktop-webgis/ogc-io'
import type { WfsServiceSource } from '@desktop-webgis/gis-core'

export interface StartWfsLoadInput {
  layerId: string
  datasetId: string
  description: ServiceDescription
  selection: ResolveWfsSelection
  authMode: 'none' | 'query-token' | 'bearer'
  tokenParam?: string
  credentialRefKey?: string
  /** When true, failure keeps previous features (refresh). */
  isRefresh?: boolean
}

/**
 * Start a bounded WFS snapshot load. Safe against cancel / delete / project switch.
 * Refresh failures keep the previous snapshot.
 */
export async function startWfsBoundedLoad(input: StartWfsLoadInput): Promise<void> {
  const session = useSessionStore.getState()
  const loadGeneration = session.wfsLoadGeneration
  const loadToken = `${loadGeneration}:${input.layerId}:${Date.now()}`

  // Abort any prior load for this layer.
  session.abortWfsLoad(input.layerId)
  const controller = new AbortController()
  session.setWfsAbort(input.layerId, controller)
  session.setLayerLoading(input.layerId, true)

  const previousFeatures = useProjectStore.getState().featuresByDataset[input.datasetId] ?? []

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

    // Stale if project switched or layer removed.
    if (useSessionStore.getState().wfsLoadGeneration !== loadGeneration) {
      return
    }
    const project = useProjectStore.getState().project
    const layerStillThere = project.layers.some((l) => l.id === input.layerId)
    const datasetStillThere = project.datasets.some((d) => d.id === input.datasetId)
    if (!layerStillThere || !datasetStillThere) {
      return
    }

    if (!result.ok) {
      if (result.code === 'cancelled') {
        emitCommandStatus('已取消 WFS 加载')
        return
      }
      if (input.isRefresh) {
        // Keep previous snapshot on refresh failure.
        emitCommandStatus(`WFS 刷新失败，已保留原快照：${result.message}`)
        return
      }
      // First load with partial pages: apply partial as incomplete snapshot.
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
    useSessionStore.getState().setLayerLoading(input.layerId, false)
    useSessionStore.getState().setWfsAbort(input.layerId, null)
    // Silence unused previousFeatures when refresh succeeded — kept for clarity.
    void previousFeatures
  }
}

function applySnapshot(
  datasetId: string,
  features: import('@desktop-webgis/gis-core').GisFeature[],
  meta: Partial<WfsServiceSource>
): void {
  const store = useProjectStore.getState()
  store.setDatasetFeatures(datasetId, features)
  store.patchWfsServiceSource(datasetId, meta)
}

/** Refresh an existing WFS layer snapshot using stored source + last known capabilities selection. */
export async function refreshWfsLayer(layerId: string): Promise<void> {
  const state = useProjectStore.getState()
  const layer = state.project.layers.find((l) => l.id === layerId)
  if (!layer) {
    emitCommandStatus('图层不存在')
    return
  }
  const dataset = state.project.datasets.find((d) => d.id === layer.datasetId)
  if (!dataset || dataset.kind !== 'wfs') {
    emitCommandStatus('仅 WFS 快照图层支持刷新')
    return
  }

  const source = dataset.source
  const viewExtent = useSessionStore.getState().mapViewExtentWgs84
  const extentMode = source.extentMode ?? 'view'

  // Minimal ServiceDescription reconstructed from persisted source (no live catalog dump).
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
