import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Descriptions, Input, InputNumber, Modal, Select, Space, Steps, Tag, Typography } from 'antd'
import type { CartographyState, ProjectSnapshot } from '@desktop-webgis/gis-core'
import { findGroupForLayer, getLayerCartography, getLayerGroupState } from '@desktop-webgis/gis-core'
import { createGeoServerClient, hashLayer, type GeoServerFeatureType, type GeoServerLayer, type MbStyleCapability, type RemoteStyle } from '@desktop-webgis/ogc-io/geoserver-client'
import { exportSld } from '@desktop-webgis/ogc-io/sld-export'
import type { SldExportResult } from '@desktop-webgis/ogc-io/sld-export'
import { exportMbStyle } from '@desktop-webgis/ogc-io/mbstyle-export'
import type { MbStyleExportResult } from '@desktop-webgis/ogc-io/mbstyle-export'
import type { ProjectStyleAsset } from '@desktop-webgis/ol-style/style-assets'
import { encodeSldPackage } from '@desktop-webgis/ogc-io/sld-package'
import { useProjectStore } from '@/stores/project.store'
import { canPersistCredentialsSafely, persistCredentialSecurely, putSessionCredential } from '@/services/credentials'
import { createGeoServerTransport } from '@/services/geoserver-transport'
import {
  createBasicAuthorization,
  createGeoServerConnectionId,
  listGeoServerConnections,
  removeGeoServerConnection,
  saveGeoServerConnection,
  validateGeoServerBaseUrl
} from '@/services/geoserver-connections'
import type { GeoServerConnection } from '@/services/geoserver-connections'
import './geoserver-publish-dialog.css'

export interface GeoServerLoadWmsRequest {
  baseUrl: string
  workspace: string
  layerName: string
  styleName: string
  credentialRef?: string
  epoch: number
  bbox?: [number, number, number, number]
}

interface GeoServerPublishDialogProps {
  layerId: string
  onClose: () => void
  onLoadWms?: (request: GeoServerLoadWmsRequest) => void
}

interface PreflightBase {
  inputKey: string
  featureType: GeoServerFeatureType
  remoteLayer: GeoServerLayer
  remoteStyle?: RemoteStyle
  missingFields: string[]
  geometryField?: string
  contentHash: string
  canUpdate: boolean
}

type Preflight = PreflightBase & (
  | { format: 'sld'; result: SldExportResult }
  | { format: 'mbstyle'; result: MbStyleExportResult }
)

export interface GeoServerFieldReference {
  field: string
  path: string
}

export function getRemoteStylePublishCopy(remoteStyle: RemoteStyle, canUpdate: boolean, format: 'sld' | 'mbstyle' = 'sld'): { message: string; confirmation: string } {
  const formatLabel = format === 'sld' ? 'SLD' : 'MBStyle'
  if (!remoteStyle.etag) {
    return {
      message: 'GeoServer 未提供该样式的条件写入标识。发布会保留远端现有版本并创建一个新的不可变样式版本，再将目标图层指向新版本。',
      confirmation: `我同意创建新 ${formatLabel} 版本并更新图层关联；远端旧版本会保留。`
    }
  }
  if (canUpdate) return {
    message: '远端样式指纹与本图层上次发布记录一致，可以通过条件写入更新。',
    confirmation: `我确认覆盖远端同名 ${formatLabel}。`
  }
  return {
    message: '远端存在同名样式，且与本图层上次发布记录不匹配；默认阻止覆盖。请改名，或明确同意覆盖。',
    confirmation: `我确认覆盖远端同名 ${formatLabel}。`
  }
}

export function getGeoServerStyleFormatOptions(capability: MbStyleCapability): Array<{ value: 'sld' | 'mbstyle'; label: string }> {
  return [
    { value: 'sld', label: 'SLD 1.0（默认）' },
    ...(capability.supported ? [{ value: 'mbstyle' as const, label: 'MBStyle JSON' }] : [])
  ]
}

function preflightContent(preflight: Preflight): string | undefined {
  return preflight.format === 'sld' ? preflight.result.sldXml : preflight.result.json
}

function ownerMatches(owner: { projectId: string; projectEpoch: number }): boolean {
  const state = useProjectStore.getState()
  return state.project.id === owner.projectId && state.projectEpoch === owner.projectEpoch
}

function valuePath(layerId: string, section: string, name: string): string {
  return `/layers/${layerId}/${section}/${name}`
}

export function collectGeoServerFieldReferences(layers: CartographyState['styleLayers']): GeoServerFieldReference[] {
  const references: GeoServerFieldReference[] = []
  function visit(value: unknown, path: string): void {
    if (!Array.isArray(value)) return
    if (['get', 'has', '!has'].includes(String(value[0])) && typeof value[1] === 'string' && (value.length === 2 || value.length === 3 && Array.isArray(value[2]) && value[2].length === 1 && value[2][0] === 'properties')) references.push({ field: value[1], path })
    if (['==', '!=', '<', '<=', '>', '>=', 'in', '!in'].includes(String(value[0])) && typeof value[1] === 'string' && !value[1].startsWith('$')) references.push({ field: value[1], path })
    if (value[0] === 'literal') return
    value.forEach((child, index) => visit(child, `${path}/${index}`))
  }
  for (const layer of layers) {
    if ('filter' in layer) visit(layer.filter, `${valuePath(layer.id, 'filter', '')}`.replace(/\/$/, ''))
    for (const section of ['paint', 'layout'] as const) {
      const properties = layer[section] as Record<string, unknown> | undefined
      for (const [name, value] of Object.entries(properties ?? {})) visit(value, valuePath(layer.id, section, name))
    }
  }
  return references
}

function referencedAssets(layers: CartographyState['styleLayers'], assets: readonly ProjectStyleAsset[]): ProjectStyleAsset[] {
  const ids = new Set<string>()
  for (const layer of layers) {
    for (const [section, property] of [['layout', 'icon-image'], ['paint', 'fill-pattern'], ['paint', 'line-pattern']] as const) {
      const properties = layer[section] as Record<string, unknown> | undefined
      const value = properties?.[property]
      if (typeof value === 'string') ids.add(value)
      else if (Array.isArray(value) && value[0] === 'image' && typeof value[1] === 'string') ids.add(value[1])
    }
  }
  return assets.filter(asset => ids.has(asset.id) || ids.has(asset.name))
}

async function hashContent(layers: CartographyState['styleLayers'], assets: readonly ProjectStyleAsset[]): Promise<string> {
  const payload = JSON.stringify({
    layers,
    assets: assets.map(asset => ({ id: asset.id, mimeType: asset.mimeType, contentHash: asset.contentHash, dataUrl: asset.dataUrl }))
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function findGeometryFields(featureType: GeoServerFeatureType): string[] {
  return (featureType.attributes?.attribute ?? [])
    .filter(attribute => /(?:\.geom\.|geometry|point|linestring|polygon|multipolygon|multilinestring)/i.test(attribute.binding))
    .map(attribute => attribute.name)
}

export function inferGeoServerFieldTypes(featureType: GeoServerFeatureType): Record<string, 'string' | 'number' | 'boolean'> {
  const fieldTypes: Record<string, 'string' | 'number' | 'boolean'> = {}
  for (const attribute of featureType.attributes?.attribute ?? []) {
    const binding = attribute.binding.split(/[.$]/).pop()?.toLowerCase() ?? ''
    if (binding === 'string' || binding === 'char' || binding === 'character') fieldTypes[attribute.name] = 'string'
    else if (['numeric', 'integer', 'double', 'float', 'long', 'short', 'bigdecimal', 'biginteger'].includes(binding)) fieldTypes[attribute.name] = 'number'
    else if (binding === 'boolean') fieldTypes[attribute.name] = 'boolean'
  }
  return fieldTypes
}

function formatXml(xml: string): string {
  return xml.replace(/></g, '>\n<')
}

function xmlDifferences(local: string, remote: string): string {
  const left = formatXml(local).split('\n'), right = formatXml(remote).split('\n')
  const rows: string[] = []
  for (let index = 0; index < Math.max(left.length, right.length) && rows.length < 32; index++) {
    if (left[index] === right[index]) continue
    if (left[index] !== undefined) rows.push(`− ${left[index]}`)
    if (right[index] !== undefined) rows.push(`+ ${right[index]}`)
  }
  return rows.length ? rows.join('\n') : '格式化后的内容一致，但规范化 XML 指纹不同。'
}

function styleDifferences(local: string, remote: string, format: 'sld' | 'mbstyle'): string {
  if (format === 'sld') return xmlDifferences(local, remote)
  try { local = JSON.stringify(JSON.parse(local), null, 2) } catch { /* Keep raw response for diagnostics. */ }
  try { remote = JSON.stringify(JSON.parse(remote), null, 2) } catch { /* Keep raw response for diagnostics. */ }
  const left = local.split('\n'), right = remote.split('\n')
  const rows: string[] = []
  for (let index = 0; index < Math.max(left.length, right.length) && rows.length < 32; index++) {
    if (left[index] === right[index]) continue
    if (left[index] !== undefined) rows.push(`− ${left[index]}`)
    if (right[index] !== undefined) rows.push(`+ ${right[index]}`)
  }
  return rows.length ? rows.join('\n') : '格式化后的内容一致，但规范化 JSON 指纹不同。'
}

function safeStyleName(value: string): string {
  const normalized = value.trim().replace(/[^\w.-]+/g, '-')
  return normalized.replace(/^-+|-+$/g, '')
}

function hasValidBbox(featureType: GeoServerFeatureType): boolean {
  const bbox = featureType.latLonBoundingBox
  return !!bbox && [bbox.minx, bbox.miny, bbox.maxx, bbox.maxy].every(Number.isFinite)
    && bbox.minx <= bbox.maxx && bbox.miny <= bbox.maxy
}

export function GeoServerPublishDialog({ layerId, onClose, onLoadWms }: GeoServerPublishDialogProps) {
  const publishStartedRef = useRef(false)
  const project = useProjectStore(state => state.project)
  const projectId = project.id
  const projectEpoch = useProjectStore(state => state.projectEpoch)
  const owner = useRef({ projectId: useProjectStore.getState().project.id, projectEpoch: useProjectStore.getState().projectEpoch }).current
  const layer = project.layers.find(item => item.id === layerId)
  const dataset = project.datasets.find(item => item.id === layer?.datasetId)
  const fragment = useMemo(() => getLayerCartography(project, layerId), [project, layerId])
  const fragmentAssets = useMemo(() => referencedAssets(fragment?.styleLayers ?? [], project.cartography?.assets ?? []), [fragment, project.cartography?.assets])

  const [connections, setConnections] = useState(() => listGeoServerConnections())
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [connectionId, setConnectionId] = useState(() => createGeoServerConnectionId())
  const [connectionName, setConnectionName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [credentialRef, setCredentialRef] = useState<string>()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [persistSecret, setPersistSecret] = useState(false)
  const [activeConnection, setActiveConnection] = useState<GeoServerConnection>()
  const [mbStyleCapability, setMbStyleCapability] = useState<MbStyleCapability>({ supported: false, reason: '尚未探测服务器扩展' })
  const [format, setFormat] = useState<'sld' | 'mbstyle'>('sld')
  const clientRef = useRef<ReturnType<typeof createGeoServerClient> | null>(null)
  const [workspaces, setWorkspaces] = useState<string[]>([])
  const [workspace, setWorkspace] = useState<string>()
  const [stores, setStores] = useState<string[]>([])
  const [store, setStore] = useState<string>()
  const [featureTypes, setFeatureTypes] = useState<string[]>([])
  const [featureTypeName, setFeatureTypeName] = useState<string>()
  const [featureType, setFeatureType] = useState<GeoServerFeatureType>()
  const [geometryField, setGeometryField] = useState<string>()
  const [styleName, setStyleName] = useState('')
  const [previewZoom, setPreviewZoom] = useState<number>()
  const [step, setStep] = useState(0)
  const [preflight, setPreflight] = useState<Preflight>()
  const [allowApproximation, setAllowApproximation] = useState(false)
  const [allowOverride, setAllowOverride] = useState(false)
  const [loading, setLoading] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [success, setSuccess] = useState(false)
  const [contentFingerprint, setContentFingerprint] = useState('')
  const requestRef = useRef<AbortController | null>(null)
  const requestKindRef = useRef<'connect' | 'catalog' | 'preflight' | 'publish' | undefined>(undefined)
  const requestSequence = useRef(0)
  const inputKeyRef = useRef('')
  const connectionInputKeyRef = useRef('')

  const connectionKey = activeConnection ? `${activeConnection.id}:${activeConnection.baseUrl}:${activeConnection.credentialRef ?? ''}` : ''
  const inputKey = JSON.stringify({
    connectionKey, workspace, store, featureTypeName, styleName, previewZoom, geometryField, format,
    fragment: fragment?.styleLayers,
    assetHashes: fragmentAssets.map(asset => [asset.id, asset.contentHash])
  })
  inputKeyRef.current = inputKey
  connectionInputKeyRef.current = JSON.stringify({ connectionId, connectionName, baseUrl, credentialRef, username, password, persistSecret })
  const geometryFields = featureType ? findGeometryFields(featureType) : []
  const isOwnerCurrent = projectId === owner.projectId && projectEpoch === owner.projectEpoch && ownerMatches(owner)
  const groupLocked = !!(layer && getLayerGroupState(project, findGroupForLayer(project, layerId)?.id).locked)
  const linkedStyle = layer?.publishedStyle
  const hasUnsupported = preflight?.result.issues.some(issue => issue.level === 'unsupported') || (preflight?.missingFields.length ?? 0) > 0
  const hasApproximation = preflight?.result.issues.some(issue => issue.level === 'approximated') ?? false
  const styleConflict = !!preflight?.remoteStyle && !preflight.canUpdate
  const canPublish = !!preflight && preflight.inputKey === inputKey && !!preflightContent(preflight) && !hasUnsupported
    && !!preflight.featureType.srs?.trim() && hasValidBbox(preflight.featureType)
    && (!hasApproximation || allowApproximation) && (!styleConflict || allowOverride) && !loading && !publishing && isOwnerCurrent && !groupLocked

  useEffect(() => {
    void hashContent(fragment?.styleLayers ?? [], fragmentAssets).then(setContentFingerprint).catch(() => setContentFingerprint(''))
  }, [fragment?.styleLayers, fragmentAssets])

  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe(state => {
      if (state.project.id !== owner.projectId || state.projectEpoch !== owner.projectEpoch) {
        requestRef.current?.abort()
        requestRef.current = null
        setLoading(false)
        setPublishing(false)
        setPreflight(undefined)
        setError('工程已切换，本次窗口已停止操作，请关闭后从当前工程重新打开。')
      }
    })
    return () => {
      unsubscribe()
      requestRef.current?.abort()
      requestRef.current = null
    }
  }, [owner])

  useEffect(() => {
    if (!preflight || preflight.inputKey === inputKey) return
    if (requestKindRef.current === 'preflight' || requestKindRef.current === 'publish') requestRef.current?.abort()
    setPreflight(undefined)
    setAllowApproximation(false)
    setAllowOverride(false)
  }, [inputKey, preflight])

  function beginRequest(kind: NonNullable<typeof requestKindRef.current>): { controller: AbortController; sequence: number } {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    requestKindRef.current = kind
    setLoading(kind !== 'publish')
    setPublishing(kind === 'publish')
    return { controller, sequence: ++requestSequence.current }
  }

  function isActive(sequence: number, controller: AbortController): boolean {
    return requestSequence.current === sequence && requestRef.current === controller && !controller.signal.aborted
  }

  function finishRequest(sequence: number, controller: AbortController): void {
    if (requestSequence.current !== sequence || requestRef.current !== controller) return
    requestRef.current = null
    requestKindRef.current = undefined
    setLoading(false)
    setPublishing(false)
  }

  function invalidatePreflight(): void {
    if (requestKindRef.current === 'preflight' || requestKindRef.current === 'publish') requestRef.current?.abort()
    setPreflight(undefined)
    setAllowApproximation(false)
    setAllowOverride(false)
    setError('')
  }

  function handleConnectionSelect(id: string): void {
    invalidatePreflight()
    requestRef.current?.abort()
    const selected = connections.find(item => item.id === id)
    setSelectedConnectionId(id)
    setConnectionId(selected?.id ?? createGeoServerConnectionId())
    setConnectionName(selected?.name ?? '')
    setBaseUrl(selected?.baseUrl ?? '')
    setCredentialRef(selected?.credentialRef)
    setUsername('')
    setPassword('')
    setActiveConnection(undefined)
    setMbStyleCapability({ supported: false, reason: '尚未探测服务器扩展' })
    setFormat('sld')
    clientRef.current = null
    setWorkspaces([])
    setWorkspace(undefined)
    setStores([])
    setStore(undefined)
    setFeatureTypes([])
    setFeatureTypeName(undefined)
    setFeatureType(undefined)
    setStep(0)
  }

  function changeServerAddress(value: string): void {
    requestRef.current?.abort()
    requestSequence.current++
    setBaseUrl(value)
    setCredentialRef(undefined)
    setSelectedConnectionId('')
    setConnectionId(createGeoServerConnectionId())
    setUsername(''); setPassword('')
    setActiveConnection(undefined); clientRef.current = null
    setMbStyleCapability({ supported: false, reason: '尚未探测服务器扩展' }); setFormat('sld')
    setWorkspaces([]); setWorkspace(undefined); setStores([]); setStore(undefined)
    setFeatureTypes([]); setFeatureTypeName(undefined); setFeatureType(undefined)
    setPreflight(undefined); setLoading(false); setPublishing(false)
  }

  async function connect(): Promise<void> {
    const current = useProjectStore.getState()
    if (current.project.id !== owner.projectId || current.projectEpoch !== owner.projectEpoch) { setError('工程已切换，请关闭窗口并重新打开。'); return }
    let normalizedUrl: string
    try { normalizedUrl = validateGeoServerBaseUrl(baseUrl) } catch (reason) { setError(reason instanceof Error ? reason.message : 'GeoServer 地址无效'); return }
    const capturedConnectionInput = connectionInputKeyRef.current
    setError('')
    const { controller, sequence } = beginRequest('connect')
    try {
      let nextCredentialRef = credentialRef
      if (username || password) {
        if (!username || !password) throw new Error('请同时填写用户名和密码，或留空使用已保存凭据。')
        nextCredentialRef = putSessionCredential({ kind: 'http-authorization', value: createBasicAuthorization(username, password) })
        if (persistSecret && !(await persistCredentialSecurely(nextCredentialRef))) throw new Error('未能将凭据保存到设备安全存储；没有保存连接密钥。')
      }
      if (connectionInputKeyRef.current !== capturedConnectionInput) throw new Error('连接表单在准备凭据期间已改变，请重新连接。')
      if (!isActive(sequence, controller) || !ownerMatches(owner)) return
      const connection: GeoServerConnection = {
        id: connectionId || createGeoServerConnectionId(), name: connectionName.trim() || new URL(normalizedUrl).host,
        baseUrl: normalizedUrl, ...(nextCredentialRef ? { credentialRef: nextCredentialRef } : {})
      }
      const client = createGeoServerClient(connection.baseUrl, createGeoServerTransport({ credentialRef: connection.credentialRef, allowedOrigin: new URL(connection.baseUrl).origin }))
      const foundWorkspaces = await client.listWorkspaces(controller.signal)
      if (!isActive(sequence, controller) || !ownerMatches(owner)) return
      if (connectionInputKeyRef.current !== capturedConnectionInput) throw new Error('连接表单在服务器响应期间已改变；已忽略旧响应。')
      const mbStyleSupport = await client.probeMbStyleSupport(controller.signal)
      if (!isActive(sequence, controller) || !ownerMatches(owner) || connectionInputKeyRef.current !== capturedConnectionInput) return
      setCredentialRef(nextCredentialRef)
      setConnectionId(connection.id)
      setActiveConnection(connection)
      setMbStyleCapability(mbStyleSupport)
      setFormat('sld')
      if (connections.some(item => item.id === connection.id)) {
        saveGeoServerConnection(connection)
        setConnections(listGeoServerConnections())
      }
      clientRef.current = client
      setWorkspaces(foundWorkspaces)
      setWorkspace(undefined)
      setStores([])
      setStore(undefined)
      setFeatureTypes([])
      setFeatureTypeName(undefined)
      setFeatureType(undefined)
      setStep(1)
      if (!foundWorkspaces.length) setError('连接成功，但服务器没有可用 workspace。')
    } catch (reason) {
      if (isActive(sequence, controller)) setError(reason instanceof Error ? reason.message : 'GeoServer 连接失败。')
    } finally { finishRequest(sequence, controller) }
  }

  function saveConnection(): void {
    try {
      const saved = saveGeoServerConnection({
        id: activeConnection?.id ?? connectionId,
        name: (activeConnection?.name ?? connectionName).trim() || new URL(baseUrl).host,
        baseUrl: activeConnection?.baseUrl ?? baseUrl,
        ...(activeConnection?.credentialRef ?? credentialRef ? { credentialRef: activeConnection?.credentialRef ?? credentialRef } : {})
      })
      setConnections(saved)
      setSelectedConnectionId(activeConnection?.id ?? connectionId)
      setConnectionId(activeConnection?.id ?? connectionId)
      setConnectionName(activeConnection?.name ?? connectionName)
      setError('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '连接配置无法保存。') }
  }

  function deleteConnection(): void {
    const id = activeConnection?.id ?? selectedConnectionId
    if (!id) return
    const saved = removeGeoServerConnection(id)
    setConnections(saved)
    if (selectedConnectionId === id) handleConnectionSelect('')
  }

  async function chooseWorkspace(value: string): Promise<void> {
    invalidatePreflight()
    setWorkspace(value)
    setStores([])
    setStore(undefined)
    setFeatureTypes([])
    setFeatureTypeName(undefined)
    setFeatureType(undefined)
    const client = clientRef.current
    if (!client) return
    const { controller, sequence } = beginRequest('catalog')
    try {
      const items = await client.listStores(value, controller.signal)
      if (isActive(sequence, controller) && ownerMatches(owner)) setStores(items)
    } catch (reason) { if (isActive(sequence, controller)) setError(reason instanceof Error ? reason.message : '读取 datastore 失败。') }
    finally { finishRequest(sequence, controller) }
  }

  async function chooseStore(value: string): Promise<void> {
    invalidatePreflight()
    setStore(value)
    setFeatureTypes([])
    setFeatureTypeName(undefined)
    setFeatureType(undefined)
    if (!workspace || !clientRef.current) return
    const { controller, sequence } = beginRequest('catalog')
    try {
      const items = await clientRef.current.listFeatureTypes(workspace, value, controller.signal)
      if (isActive(sequence, controller) && ownerMatches(owner)) setFeatureTypes(items)
    } catch (reason) { if (isActive(sequence, controller)) setError(reason instanceof Error ? reason.message : '读取要素类型失败。') }
    finally { finishRequest(sequence, controller) }
  }

  async function chooseFeatureType(value: string): Promise<void> {
    invalidatePreflight()
    setFeatureTypeName(value)
    setFeatureType(undefined)
    setGeometryField(undefined)
    setStyleName(safeStyleName(value))
    if (!workspace || !store || !clientRef.current) return
    const { controller, sequence } = beginRequest('catalog')
    try {
      const result = await clientRef.current.readFeatureType(workspace, store, value, controller.signal)
      if (isActive(sequence, controller) && ownerMatches(owner)) setFeatureType(result)
    } catch (reason) { if (isActive(sequence, controller)) setError(reason instanceof Error ? reason.message : '读取 FeatureType 失败。') }
    finally { finishRequest(sequence, controller) }
  }

  async function runPreflight(): Promise<void> {
    if (!activeConnection || !workspace || !store || !featureTypeName || !clientRef.current || !fragment || !layer) {
      setError('请先连接服务器并选择 workspace、datastore 和已存在的要素类型。')
      return
    }
    if (!isOwnerCurrent) { setError('工程已切换，请关闭窗口后重新打开。'); return }
    if (groupLocked) { setError('图层或所属文件夹已锁定，不能发布。'); return }
    if (dataset?.kind !== 'vector' && dataset?.kind !== 'wfs') { setError('仅支持绑定到现有矢量/WFS 数据的样式发布。'); return }
    if (!styleName.trim()) { setError('请输入远端样式名。'); return }
    if (format === 'mbstyle' && !mbStyleCapability.supported) { setError('服务器未确认支持 MBStyle。'); return }
    setError('')
    setPreflight(undefined)
    setAllowApproximation(false)
    setAllowOverride(false)
    const capturedKey = inputKeyRef.current
    const capturedContent = await hashContent(fragment.styleLayers, fragmentAssets)
    if (!ownerMatches(owner) || inputKeyRef.current !== capturedKey) { setError('本地样式或目标在预检开始前已改变，请重新预检。'); return }
    const { controller, sequence } = beginRequest('preflight')
    try {
      const client = clientRef.current
      const [remoteFeatureType, remoteLayer, remoteStyle] = await Promise.all([
        client.readFeatureType(workspace, store, featureTypeName, controller.signal),
        client.readLayer(workspace, featureTypeName, controller.signal),
        format === 'sld' ? client.readStyle(workspace, styleName.trim(), controller.signal) : client.readMbStyle(workspace, styleName.trim(), controller.signal)
      ])
      if (!isActive(sequence, controller) || !ownerMatches(owner) || inputKeyRef.current !== capturedKey) return
      if (!remoteFeatureType.srs?.trim()) throw new Error('目标 FeatureType 未提供 CRS，不能发布样式。')
      if (!hasValidBbox(remoteFeatureType)) throw new Error('目标 FeatureType 未提供有效的 WGS84 范围，无法验证 WMS 输出。')
      const attributes = remoteFeatureType.attributes?.attribute ?? []
      const known = new Set(attributes.map(attribute => attribute.name))
      const missingFields = [...new Set(collectGeoServerFieldReferences(fragment.styleLayers).filter(reference => !known.has(reference.field)).map(reference => reference.field))]
      const autoGeometryField = findGeometryFields(remoteFeatureType)[0]
      const selectedGeometryField = geometryField && known.has(geometryField) ? geometryField : autoGeometryField
      const link = layer.publishedStyle
      const canUpdate = !!remoteStyle && !!link && link.connectionId === activeConnection.id && link.workspace === workspace
        && link.store === store && link.layerName === featureTypeName && link.styleName === styleName.trim() && link.remoteFormat === format && link.lastPublishedHash === remoteStyle.hash
      const common: PreflightBase = {
        inputKey: capturedKey, featureType: remoteFeatureType, remoteLayer,
        ...(remoteStyle ? { remoteStyle } : {}), missingFields,
        ...(selectedGeometryField ? { geometryField: selectedGeometryField } : {}),
        contentHash: capturedContent, canUpdate
      }
      if (format === 'sld') {
        const result = exportSld(fragment.styleLayers, {
          targetLayerName: styleName.trim(),
          crs: remoteFeatureType.srs ?? '',
          geometryField: selectedGeometryField,
          fieldTypes: inferGeoServerFieldTypes(remoteFeatureType),
          assets: fragmentAssets.filter(asset => asset.mimeType !== 'font/woff2'),
          ...(previewZoom === undefined ? {} : { previewZoom }),
          strict: true
        })
        if (!isActive(sequence, controller) || !ownerMatches(owner) || inputKeyRef.current !== capturedKey) return
        setFeatureType(remoteFeatureType)
        setPreflight({ ...common, format: 'sld', result })
      } else {
        const result = await exportMbStyle(fragment.styleLayers, { name: styleName.trim(), strict: true })
        if (!isActive(sequence, controller) || !ownerMatches(owner) || inputKeyRef.current !== capturedKey) return
        setFeatureType(remoteFeatureType)
        setPreflight({ ...common, format: 'mbstyle', result })
      }
    } catch (reason) {
      if (isActive(sequence, controller)) setError(reason instanceof Error ? reason.message : '预检失败。')
    } finally { finishRequest(sequence, controller) }
  }

  async function publish(): Promise<void> {
    if (publishStartedRef.current) return
    publishStartedRef.current = true
    try { await executePublish() }
    catch (reason) { setError(reason instanceof Error ? reason.message : '发布失败') }
    finally { publishStartedRef.current = false }
  }

  async function executePublish(): Promise<void> {
    const checked = preflight
    const currentFragment = getLayerCartography(useProjectStore.getState().project, layerId)
    const currentState = useProjectStore.getState()
    const currentLayer = currentState.project.layers.find(item => item.id === layerId)
    if (!checked || checked.inputKey !== inputKeyRef.current || !preflightContent(checked) || hasUnsupported) { setError('预检结果已失效或存在不支持项，请重新预检。'); return }
    if (!activeConnection || !workspace || !store || !featureTypeName || !clientRef.current) { setError('连接或目标选择已改变，请重新预检。'); return }
    if (currentState.project.id !== owner.projectId || currentState.projectEpoch !== owner.projectEpoch || !currentLayer || !currentFragment) { setError('工程已切换或目标图层已删除，本次发布已取消。'); return }
    if (getLayerGroupState(currentState.project, findGroupForLayer(currentState.project, layerId)?.id).locked) { setError('图层或所属文件夹已锁定，不能发布。'); return }
    if (styleConflict && !allowOverride) { setError('远端已有不同版本，请明确同意覆盖，或更换样式名。'); return }
    if (hasApproximation && !allowApproximation) { setError('样式存在近似降级，请明确同意后发布。'); return }
    if (checked.format !== format) { setError('发布格式已改变，请重新预检。'); return }
    const target = { connectionId: activeConnection.id, workspace, store, layerName: featureTypeName, styleName: styleName.trim(), format }
    const client = clientRef.current
    if (await hashContent(currentFragment.styleLayers, referencedAssets(currentFragment.styleLayers, currentState.project.cartography?.assets ?? [])) !== checked.contentHash) {
      setError('本地图层样式在预检后已变化，请重新预检。')
      return
    }
    const remoteLayerHash = await hashLayer(checked.remoteLayer)
    if (!ownerMatches(owner) || inputKeyRef.current !== checked.inputKey) { setError('预检目标在准备发布时已改变，请重新预检。'); return }
    const { controller, sequence } = beginRequest('publish')
    setError('')
    setLogs([])
    try {
      const sldResult = checked.result as SldExportResult
      const output = preflightContent(checked)!
      const packageBytes = checked.format === 'sld' && sldResult.assets.length ? await encodeSldPackage(sldResult, controller.signal) : undefined
      if (!isActive(sequence, controller) || inputKeyRef.current !== checked.inputKey || !ownerMatches(owner)) return
      const publishInput = {
        workspace: target.workspace, layerName: target.layerName, styleName: target.styleName,
        ...(checked.remoteStyle ? { expectedRemoteHash: checked.remoteStyle.hash } : {}), expectedLayerHash: remoteLayerHash,
        bbox: [checked.featureType.latLonBoundingBox!.minx, checked.featureType.latLonBoundingBox!.miny, checked.featureType.latLonBoundingBox!.maxx, checked.featureType.latLonBoundingBox!.maxy] as [number, number, number, number],
        signal: controller.signal,
        onStep: (entry: { status: string; step: string; message?: string }) => setLogs(previous => [...previous, `${entry.status === 'passed' ? '✓' : entry.status === 'failed' ? '✕' : '…'} ${entry.step}${entry.message ? `：${entry.message}` : ''}`])
      }
      const result = checked.format === 'sld'
        ? await client.publish({ ...publishInput, sld: output, ...(packageBytes ? { packageBytes } : {}) })
        : await client.publishMbStyle({ ...publishInput, mbstyle: output })
      if (!isActive(sequence, controller) || !ownerMatches(owner) || inputKeyRef.current !== checked.inputKey) {
        setError('发布期间工程或输入已改变；服务器结果保留，但没有写回其他工程。')
        return
      }
      const latest = useProjectStore.getState()
      const latestFragment = getLayerCartography(latest.project, layerId)
      const latestContentHash = latestFragment
        ? await hashContent(latestFragment.styleLayers, referencedAssets(latestFragment.styleLayers, latest.project.cartography?.assets ?? []))
        : ''
      const committedState = useProjectStore.getState()
      const committedFragment = getLayerCartography(committedState.project, layerId)
      const committedLayer = committedState.project.layers.find(item => item.id === layerId)
      if (!isActive(sequence, controller) || inputKeyRef.current !== checked.inputKey || JSON.stringify(committedFragment) !== JSON.stringify(latestFragment) || committedState.project.cartography?.assets !== latest.project.cartography?.assets || committedState.project.id !== owner.projectId || committedState.projectEpoch !== owner.projectEpoch || !committedLayer || !committedFragment
          || getLayerGroupState(committedState.project, findGroupForLayer(committedState.project, layerId)?.id).locked
          || latestContentHash !== checked.contentHash
          || committedState.project.id !== latest.project.id || committedState.projectEpoch !== latest.projectEpoch) {
        setError('发布完成，但本地图层在等待期间发生变化或已锁定；远端结果保留，本地链接未更新。')
        return
      }
      const snapshot = committedState.getSnapshot()
      const next: ProjectSnapshot = {
        ...snapshot,
        project: {
          ...snapshot.project,
          layers: snapshot.project.layers.map(item => item.id === layerId ? {
            ...item,
            publishedStyle: {
              connectionId: target.connectionId, workspace: target.workspace, store: target.store, layerName: target.layerName,
              styleName: result.styleName, remoteFormat: target.format,
              lastPublishedHash: result.remoteHash, lastPublishedAt: new Date().toISOString(), lastPublishedContentHash: checked.contentHash
            }
          } : item)
        }
      }
      if (!committedState.applySnapshotAsEdit(next, '发布 GeoServer 样式')) throw new Error('发布成功，但工程链接未能写入；远端结果保留。')
      setContentFingerprint(checked.contentHash)
      setStyleName(result.styleName)
      setSuccess(true)
      setError('')
    } catch (reason) {
      if (isActive(sequence, controller)) setError(reason instanceof Error ? reason.message : 'GeoServer 样式发布失败。')
    } finally { finishRequest(sequence, controller) }
  }

  function loadWms(): void {
    if (!activeConnection || !workspace || !featureTypeName || !success || !isOwnerCurrent || !onLoadWms) return
    const bbox = preflight?.featureType.latLonBoundingBox
    onLoadWms({
      baseUrl: activeConnection.baseUrl, workspace, layerName: featureTypeName, styleName: styleName.trim(), epoch: owner.projectEpoch,
      ...(activeConnection.credentialRef ? { credentialRef: activeConnection.credentialRef } : {}),
      ...(bbox ? { bbox: [bbox.minx, bbox.miny, bbox.maxx, bbox.maxy] as [number, number, number, number] } : {})
    })
  }

  function close(): void {
    requestSequence.current++
    requestRef.current?.abort()
    requestRef.current = null
    onClose()
  }

  if (!layer) return <Modal open title="发布到 GeoServer" onCancel={close} footer={<Button onClick={close}>关闭</Button>}><Alert type="error" message="目标图层已删除。" /></Modal>

  return <Modal
    open
    title={`发布“${layer.name}”到 GeoServer`}
    width={1000}
    onCancel={close}
    destroyOnHidden
    footer={<Space>
      <Button onClick={close}>{success ? '完成' : '关闭'}</Button>
      {step > 0 && !success && <Button disabled={loading || publishing} onClick={() => { invalidatePreflight(); setStep(step - 1) }}>上一步</Button>}
      {step === 2 && !success && <Button onClick={() => void runPreflight()} loading={loading}>重新预检</Button>}
      {step === 2 && !success && <Button type="primary" disabled={!canPublish} loading={publishing} onClick={() => void publish()}>发布并验证</Button>}
      {success && onLoadWms && <Button type="primary" onClick={loadWms}>加载已发布 WMS</Button>}
    </Space>}
  >
    <Steps className="geoserver-publish__steps" current={step} items={[{ title: '连接' }, { title: '选择目标数据' }, { title: '预检与发布' }]} />
    {!isOwnerCurrent && <Alert type="error" showIcon message="当前工程已切换，窗口操作已冻结。" />}
    {groupLocked && <Alert type="warning" showIcon message="图层或所属文件夹已锁定，发布会被禁止。" />}
    {linkedStyle && contentFingerprint && contentFingerprint !== linkedStyle.lastPublishedContentHash && <Alert type="warning" showIcon message="本地样式自上次发布后已变化；保存不会自动发布。" />}
    {error && <Alert className="geoserver-publish__error" type="error" showIcon message={error} />}

    {step === 0 && !success && <div className="geoserver-publish__step">
      <Alert type="info" showIcon message="只发布样式，不会上传或创建数据。请先在 GeoServer 中准备目标 workspace、datastore 和要素类型。" />
      <label className="geoserver-publish__field"><span>已保存连接</span><Select allowClear value={selectedConnectionId || undefined} placeholder="新建连接或选择已保存连接" options={connections.map(item => ({ value: item.id, label: item.name }))} onChange={handleConnectionSelect} /></label>
      <label className="geoserver-publish__field"><span>连接名称</span><Input value={connectionName} onChange={event => setConnectionName(event.target.value)} placeholder="例如：生产 GeoServer" /></label>
      <label className="geoserver-publish__field"><span>GeoServer 根地址</span><Input value={baseUrl} onChange={event => changeServerAddress(event.target.value)} placeholder="https://maps.example.com/geoserver" autoComplete="url" /></label>
      <div className="geoserver-publish__credentials">
        <label className="geoserver-publish__field"><span>用户名（Basic Auth）</span><Input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label className="geoserver-publish__field"><span>密码</span><Input.Password autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      </div>
      <Checkbox checked={persistSecret} disabled={!canPersistCredentialsSafely()} onChange={event => setPersistSecret(event.target.checked)}>将新凭据保存到设备安全存储</Checkbox>
      <Typography.Paragraph type="secondary">连接配置只保存在本机 localStorage，凭据只通过安全凭据库引用；密码不会写入工程或连接配置。</Typography.Paragraph>
      <Space>
        <Button type="primary" loading={loading} disabled={!isOwnerCurrent} onClick={() => void connect()}>连接并发现 Workspace</Button>
        <Button disabled={!baseUrl.trim()} onClick={saveConnection}>保存连接配置</Button>
        {selectedConnectionId && <Button danger onClick={deleteConnection}>删除连接配置</Button>}
      </Space>
    </div>}

    {step === 1 && !success && <div className="geoserver-publish__step">
      <Alert type="info" showIcon message="从服务器目录选择已经存在的要素类型；发布操作只创建/更新样式并关联目标图层。" />
      <label className="geoserver-publish__field"><span>Workspace</span><Select aria-label="Workspace" value={workspace} placeholder="选择 Workspace" options={workspaces.map(value => ({ value, label: value }))} loading={loading} disabled={loading || !isOwnerCurrent} onChange={value => void chooseWorkspace(value)} /></label>
      <label className="geoserver-publish__field"><span>Datastore</span><Select aria-label="Datastore" value={store} placeholder="选择 Datastore" options={stores.map(value => ({ value, label: value }))} loading={loading} disabled={!workspace || loading || !isOwnerCurrent} onChange={value => void chooseStore(value)} /></label>
      <label className="geoserver-publish__field"><span>已有要素类型</span><Select aria-label="已有要素类型" value={featureTypeName} placeholder="选择 FeatureType" options={featureTypes.map(value => ({ value, label: value }))} loading={loading} disabled={!store || loading || !isOwnerCurrent} onChange={value => void chooseFeatureType(value)} /></label>
      {featureType && <Descriptions size="small" column={2} items={[
        { key: 'crs', label: 'CRS', children: featureType.srs || '未声明' },
        { key: 'bbox', label: 'WGS84 范围', children: featureType.latLonBoundingBox ? `${featureType.latLonBoundingBox.minx}, ${featureType.latLonBoundingBox.miny}, ${featureType.latLonBoundingBox.maxx}, ${featureType.latLonBoundingBox.maxy}` : '未声明' }
      ]} />}
      {workspace && store && featureTypeName && featureType && <Button type="primary" disabled={loading || !isOwnerCurrent} onClick={() => setStep(2)}>继续预检</Button>}
    </div>}

    {step === 2 && !success && <div className="geoserver-publish__step">
      <label className="geoserver-publish__field"><span>远端样式格式</span><Select aria-label="远端样式格式" disabled={loading || publishing} value={format} options={getGeoServerStyleFormatOptions(mbStyleCapability)} onChange={value => { invalidatePreflight(); setFormat(value as 'sld' | 'mbstyle') }} /></label>
      <Typography.Paragraph type="secondary">{format === 'sld' ? 'SLD 1.0 标准输出。' : `MBStyle 扩展：${mbStyleCapability.reason}。仅支持预检报告中的标准子集。`}</Typography.Paragraph>
      <label className="geoserver-publish__field"><span>远端 {format === 'sld' ? 'SLD' : 'MBStyle'} 样式名</span><Input disabled={publishing} value={styleName} onChange={event => { invalidatePreflight(); setStyleName(event.target.value) }} placeholder="例如：roads-style" /></label>
      <label className="geoserver-publish__field"><span>预览 Zoom（可选）</span><InputNumber disabled={publishing} min={0} max={24} value={previewZoom} onChange={value => { invalidatePreflight(); setPreviewZoom(value ?? undefined) }} placeholder="动态 Zoom 样式需要明确指定" /></label>
      {geometryFields.length > 0 && <label className="geoserver-publish__field"><span>几何字段</span><Select disabled={publishing} allowClear value={geometryField} placeholder={`自动使用 ${geometryFields[0]}`} options={geometryFields.map(value => ({ value, label: value }))} onChange={value => { invalidatePreflight(); setGeometryField(value) }} /></label>}
      <Typography.Paragraph type="secondary">目标：{workspace} / {store} / {featureTypeName}。CRS 与 WGS84 验证范围取自 GeoServer FeatureType。</Typography.Paragraph>
      <Button type="primary" onClick={() => void runPreflight()} loading={loading} disabled={publishing || !isOwnerCurrent}>运行远端预检</Button>
      {preflight && <div className="geoserver-publish__report">
        {preflightContent(preflight) && <Descriptions size="small" column={2} items={[
          { key: 'compat', label: '兼容级别', children: preflight.result.level === 'supported' ? <Tag color="green">可直接发布</Tag> : preflight.result.level === 'approximated' ? <Tag color="gold">含近似降级</Tag> : <Tag color="red">不支持</Tag> },
          { key: 'geometry', label: '几何字段', children: preflight.geometryField ?? '未自动识别' },
          { key: 'crs', label: '目标 CRS', children: preflight.featureType.srs || '未声明' },
          { key: 'target', label: '现有图层', children: preflight.remoteLayer.name }
        ]} />}
        {!preflight.featureType.srs && <Alert type="error" message="目标 FeatureType 未提供 CRS，不能生成可发布样式。" />}
        {!preflight.featureType.latLonBoundingBox && <Alert type="error" message="目标 FeatureType 未提供 WGS84 范围，无法验证 WMS 输出。" />}
        {preflight.missingFields.length > 0 && <Alert type="error" message="样式字段未出现在目标 FeatureType 中。" description={preflight.missingFields.join('、')} />}
        {preflight.result.issues.length > 0 && <div className="geoserver-publish__issues">{preflight.result.issues.map((issue, index) => <div key={`${issue.path}:${index}`}><Tag color={issue.level === 'unsupported' ? 'red' : issue.level === 'approximated' ? 'gold' : 'green'}>{issue.level}</Tag><code>{issue.path}</code><span>{issue.reason}</span></div>)}</div>}
        {hasApproximation && <Checkbox checked={allowApproximation} onChange={event => setAllowApproximation(event.target.checked)}>我已阅读兼容报告，并同意按报告中的近似方式发布。</Checkbox>}
        {preflight.remoteStyle && (() => {
          const copy = getRemoteStylePublishCopy(preflight.remoteStyle, preflight.canUpdate, preflight.format)
          const hasConditionalWrite = !!preflight.remoteStyle.etag
          return <>
            <Alert type={preflight.canUpdate || !hasConditionalWrite ? 'info' : 'warning'} message={copy.message} />
            {!preflight.canUpdate && <Checkbox checked={allowOverride} onChange={event => setAllowOverride(event.target.checked)}>{copy.confirmation}</Checkbox>}
            {!preflight.canUpdate && preflightContent(preflight) && <details className="geoserver-publish__diff"><summary>查看本地 / 远端 {preflight.format === 'sld' ? 'XML' : 'JSON'} 差异</summary><pre>{styleDifferences(preflightContent(preflight)!, preflight.remoteStyle.content, preflight.format)}</pre></details>}
          </>
        })()}
        {preflight.format === 'sld' && (preflight.result as SldExportResult).assets.length > 0 && <Alert type="info" message={`SLD 引用 ${(preflight.result as SldExportResult).assets.length} 个项目内嵌图像资源，将作为 ZIP 一并发布；资源来源与许可保持在清单中。`} />}
      </div>}
      {logs.length > 0 && <ol className="geoserver-publish__logs">{logs.map((line, index) => <li key={`${index}:${line}`}>{line}</li>)}</ol>}
    </div>}

    {success && <div className="geoserver-publish__step">
      <Alert type="success" showIcon message="样式已发布、回读并完成 WMS PNG 验证；发布记录已写入当前工程图层。" />
      <Typography.Paragraph>本地样式后续修改不会自动推送；上方链接会提示与最后发布内容不同。</Typography.Paragraph>
      <Typography.Text type="secondary">WMS GetMap 与图例 PNG 已通过响应验证。</Typography.Text>
      {onLoadWms && <Typography.Text type="secondary">可使用“加载已发布 WMS”将远端服务加入当前工程。</Typography.Text>}
    </div>}
  </Modal>
}
