import {
  fetchGetFeaturePage,
  planBoundedGetFeaturePages,
  resolveWfsLoadOptions,
  type ResolveWfsSelection,
  type ResolvedWfsLoadOptions,
  type ServiceAuthInput,
  type ServiceDescription,
  OgcError,
  isOgcError
} from '@desktop-webgis/ogc-io'
import { parseGeoJsonFeatures, type GisFeature } from '@desktop-webgis/project'
import { fetchTextPreferNative } from '@/platform/native-http'
import { ensureCredentialLoaded, getSessionCredential } from '@/platform/credentials'

export interface WfsLoadRequest {
  description: ServiceDescription
  selection: ResolveWfsSelection
  authMode: 'none' | 'query-token' | 'bearer'
  tokenParam?: string
  credentialRefKey?: string
  signal?: AbortSignal
  /**
   * 可选的 GML 解析器，由 ol-runtime 注入，这样 ogc-io 不必依赖 OpenLayers。
   * 当解析出的输出格式是 GML 时必须提供。
   */
  parseGml?: (body: string, options: { srsName: string; importId: string }) => {
    features: GisFeature[]
    warnings: string[]
  }
  /** 代次和项目 ID，供调用方识别过期的写入。 */
  loadToken: string
}

export interface WfsLoadSnapshotResult {
  ok: true
  loadToken: string
  features: GisFeature[]
  resolved: ResolvedWfsLoadOptions
  loadedCount: number
  complete: boolean
  truncatedByLimit: boolean
  duplicateIdCount: number
  paginationUsed: boolean
  warnings: string[]
  lastLoadedAt: string
}

export interface WfsLoadSnapshotFailure {
  ok: false
  loadToken: string
  message: string
  code?: string
  /** 首次加载时，如果前面的分页成功、后面的失败，会返回部分要素。 */
  partial?: {
    features: GisFeature[]
    resolved: ResolvedWfsLoadOptions
    loadedCount: number
    duplicateIdCount: number
    paginationUsed: boolean
  }
}

export type WfsLoadResult = WfsLoadSnapshotResult | WfsLoadSnapshotFailure

async function buildAuth(
  authMode: WfsLoadRequest['authMode'],
  tokenParam: string | undefined,
  credentialRefKey: string | undefined
): Promise<ServiceAuthInput> {
  if (authMode === 'none' || !credentialRefKey) return { mode: 'none' }
  const cred =
    getSessionCredential(credentialRefKey) ?? (await ensureCredentialLoaded(credentialRefKey))
  if (!cred) return { mode: 'none' }
  if (cred.kind === 'query-token') {
    return { mode: 'query-token', param: tokenParam || cred.param || 'token', token: cred.value }
  }
  if (cred.kind === 'bearer') {
    return { mode: 'bearer', token: cred.value }
  }
  return { mode: 'none' }
}

function nativeFetchImpl(timeoutMs: number): typeof fetch {
  return ((url, init) =>
    fetchTextPreferNative(String(url), {
      headers: init?.headers as Record<string, string> | undefined,
      signal: init?.signal ?? undefined,
      timeoutMs
    })) as typeof fetch
}

/**
 * 有界的 WFS GetFeature 加载。优先使用 GeoJSON，GML 交给注入的解析器。
 * Does not write project state — caller applies snapshot when loadToken still matches.
 */
export async function loadWfsBoundedSnapshot(input: WfsLoadRequest): Promise<WfsLoadResult> {
  const resolved = resolveWfsLoadOptions(input.description, input.selection)
  if (!resolved.ok) {
    return { ok: false, loadToken: input.loadToken, message: resolved.reason }
  }

  const load = resolved.options
  if (load.outputFormat.kind === 'gml' && !input.parseGml) {
    return {
      ok: false,
      loadToken: input.loadToken,
      message: '服务仅提供 GML，但当前环境未接入 GML 解析路径'
    }
  }

  const auth = await buildAuth(input.authMode, input.tokenParam, input.credentialRefKey)
  const pages = planBoundedGetFeaturePages({
    maxFeatures: load.maxFeatures,
    usePaging: load.usePaging,
    pageSize: input.description.wfsPaging?.countDefault ?? 1000
  })

  const features: GisFeature[] = []
  const seenIds = new Set<string>()
  let duplicateIdCount = 0
  const warnings: string[] = []
  const importId = `wfs-${Date.now()}`
  let paginationUsed = pages.length > 1 || (load.usePaging && pages[0]!.pageSize < load.maxFeatures)

  try {
    for (let i = 0; i < pages.length; i++) {
      if (input.signal?.aborted) {
        throw new OgcError('cancelled', '已取消')
      }
      const page = pages[i]!
      // 如果已经用满额度就提前停止，例如上一页返回了完整的 pageSize。
      const remaining = load.maxFeatures - features.length
      if (remaining <= 0) break

      const pageSize = Math.min(page.pageSize, remaining)
      let pageResult
      try {
        pageResult = await fetchGetFeaturePage({
          load,
          startIndex: page.startIndex,
          pageSize,
          auth,
          signal: input.signal,
          timeoutMs: 30_000,
          fetchImpl: nativeFetchImpl(30_000)
        })
      } catch (err) {
        if (isOgcError(err) && err.code === 'cancelled') throw err
        if (features.length > 0) {
          // Later page failed — return partial for first-load caller; refresh caller should discard.
          return {
            ok: false,
            loadToken: input.loadToken,
            message: isOgcError(err) ? err.message : err instanceof Error ? err.message : String(err),
            code: isOgcError(err) ? err.code : 'network',
            partial: {
              features,
              resolved: load,
              loadedCount: features.length,
              duplicateIdCount,
              paginationUsed
            }
          }
        }
        throw err
      }

      let pageFeatures: GisFeature[] = []
      if (load.outputFormat.kind === 'geojson') {
        const parsed = parseGeoJsonFeatures(pageResult.body, { importId })
        pageFeatures = parsed.features
        for (const w of parsed.warnings) {
          warnings.push(w.message)
        }
      } else {
        const parsed = input.parseGml!(pageResult.body, {
          srsName: load.srsName,
          importId
        })
        pageFeatures = parsed.features
        warnings.push(...parsed.warnings)
      }

      let newOnPage = 0
      for (const feature of pageFeatures) {
        const sourceKey =
          feature.metadata?.sourceId !== undefined
            ? String(feature.metadata.sourceId)
            : feature.id
        if (seenIds.has(sourceKey)) {
          duplicateIdCount += 1
          continue
        }
        seenIds.add(sourceKey)
        features.push(feature)
        newOnPage += 1
        if (features.length >= load.maxFeatures) break
      }

      // 返回的分页比请求的少，说明服务端已经没有更多数据，停止继续翻页。
      if (pageFeatures.length < pageSize || newOnPage === 0) {
        break
      }
    }
  } catch (err) {
    if (isOgcError(err) && err.code === 'cancelled') {
      return { ok: false, loadToken: input.loadToken, message: '已取消', code: 'cancelled' }
    }
    const message = isOgcError(err)
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err)
    return {
      ok: false,
      loadToken: input.loadToken,
      message,
      code: isOgcError(err) ? err.code : undefined
    }
  }

  const truncatedByLimit = features.length >= load.maxFeatures
  // 达到产品设定的上限时，即使服务端还有数据，也按不完整处理。
  const complete = !truncatedByLimit

  return {
    ok: true,
    loadToken: input.loadToken,
    features,
    resolved: load,
    loadedCount: features.length,
    complete,
    truncatedByLimit,
    duplicateIdCount,
    paginationUsed: load.usePaging && paginationUsed,
    warnings,
    lastLoadedAt: new Date().toISOString()
  }
}
