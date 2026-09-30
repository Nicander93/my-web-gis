import {
  fetchCapabilitiesXml,
  formatOgcErrorMessage,
  listSelectableLayers,
  normalizeServiceUrl,
  parseCapabilitiesXml,
  type OgcServiceType,
  type ServiceAuthInput,
  type ServiceDescription,
  type ServiceLayerInfo
} from '@desktop-webgis/ogc-io'
import { fetchTextPreferNative } from './native-http'
import {
  canPersistCredentialsSafely,
  persistCredentialSecurely,
  putSessionCredential
} from './credentials'

export type ConnectAuthForm =
  | { mode: 'none' }
  | { mode: 'query-token'; param: string; token: string }
  | { mode: 'bearer'; token: string }

export interface ConnectServiceInput {
  url: string
  service: OgcServiceType | 'auto'
  version?: string
  auth: ConnectAuthForm
  timeoutMs?: number
  signal?: AbortSignal
  /** Monotonic generation — ignore stale responses when description inputs change. */
  generation: number
}

export interface ConnectServiceSuccess {
  ok: true
  generation: number
  shareableUrl: string
  description: ServiceDescription
  selectable: ServiceLayerInfo[]
  /** Credential ref key when auth provided; store only this on Dataset. */
  credentialRefKey?: string
  authMode: ConnectAuthForm['mode']
  tokenParam?: string
}

export interface ConnectServiceFailure {
  ok: false
  generation: number
  message: string
}

export type ConnectServiceResult = ConnectServiceSuccess | ConnectServiceFailure

function detectServiceFromUrl(url: string): OgcServiceType {
  const lower = url.toLowerCase()
  if (lower.includes('wmts')) return 'WMTS'
  if (lower.includes('wfs')) return 'WFS'
  return 'WMS'
}

/**
 * Connect to an OGC service: normalize URL, fetch capabilities, parse.
 * Does NOT add layers to the project.
 */
export async function connectService(input: ConnectServiceInput): Promise<ConnectServiceResult> {
  const generation = input.generation
  try {
    const normalized = normalizeServiceUrl(input.url, {
      tokenParamNames: input.auth.mode === 'query-token' ? [input.auth.param] : undefined
    })

    let auth: ServiceAuthInput = { mode: 'none' }
    let credentialRefKey: string | undefined
    let tokenParam: string | undefined

    if (input.auth.mode === 'query-token') {
      if (!input.auth.token.trim()) {
        return { ok: false, generation, message: '请填写 Query Token 值' }
      }
      auth = {
        mode: 'query-token',
        param: input.auth.param || 'token',
        token: input.auth.token
      }
      tokenParam = auth.param
      credentialRefKey = putSessionCredential({
        kind: 'query-token',
        param: auth.param,
        value: input.auth.token
      })
    } else if (input.auth.mode === 'bearer') {
      if (!input.auth.token.trim()) {
        return { ok: false, generation, message: '请填写 Bearer Token' }
      }
      auth = { mode: 'bearer', token: input.auth.token }
      credentialRefKey = putSessionCredential({
        kind: 'bearer',
        value: input.auth.token
      })
    }

    if (credentialRefKey && canPersistCredentialsSafely()) {
      await persistCredentialSecurely(credentialRefKey)
    }

    const service: OgcServiceType =
      input.service === 'auto' ? detectServiceFromUrl(normalized.shareableUrl) : input.service

    const xmlResult = await fetchCapabilitiesXml({
      url: normalized.shareableUrl,
      service,
      version: input.version,
      auth,
      timeoutMs: input.timeoutMs,
      signal: input.signal,
      fetchImpl: ((url, init) =>
        fetchTextPreferNative(String(url), {
          headers: init?.headers as Record<string, string> | undefined,
          signal: init?.signal ?? undefined,
          timeoutMs: input.timeoutMs
        })) as typeof fetch
    })

    if (input.signal?.aborted) {
      return { ok: false, generation, message: '已取消连接。' }
    }

    const description = parseCapabilitiesXml(xmlResult.xml, {
      shareableUrl: xmlResult.shareableUrl,
      hint: service
    })
    const selectable = listSelectableLayers(description)

    return {
      ok: true,
      generation,
      shareableUrl: xmlResult.shareableUrl,
      description,
      selectable,
      credentialRefKey,
      authMode: input.auth.mode,
      tokenParam
    }
  } catch (err) {
    return {
      ok: false,
      generation,
      message: formatOgcErrorMessage(err)
    }
  }
}