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
import { parseGeoJsonFeatures, type GisFeature } from '@desktop-webgis/gis-core'
import { fetchTextPreferNative } from './native-http'
import { ensureCredentialLoaded, getSessionCredential } from './credentials'

export interface WfsLoadRequest {
  description: ServiceDescription
  selection: ResolveWfsSelection
  authMode: 'none' | 'query-token' | 'bearer'
  tokenParam?: string
  credentialRefKey?: string
  signal?: AbortSignal
  /**
   * Optional GML parser (injected from ol-runtime to keep ogc-io free of OL).
   * Required when resolved output format is GML.
   */
  parseGml?: (body: string, options: { srsName: string; importId: string }) => {
    features: GisFeature[]
    warnings: string[]
  }
  /** Generation / project id to detect stale writes at the caller. */
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
  /** Partial features if a later page failed after some success (first load only). */
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
 * Bounded WFS GetFeature load. Prefer GeoJSON; GML via injected parser.
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
      // Stop early if we already filled the budget (e.g. previous page returned full pageSize).
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

      // Short page => server exhausted; stop paging.
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
  // If we hit the product limit, treat as incomplete even if server might have more.
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
