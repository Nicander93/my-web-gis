import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Link2, Loader2 } from 'lucide-react'
import type { OgcServiceType, ServiceDescription, ServiceLayerInfo } from '@desktop-webgis/ogc-io'
import type { DatasetKind, ServiceAuthMode, ServiceSource } from '@desktop-webgis/gis-core'
import { canPersistCredentialsSafely } from '@/services/credentials'
import {
  connectService,
  type ConnectAuthForm,
  type ConnectServiceSuccess
} from '@/services/service-connect'

export interface ServiceLayerAddRequest {
  name: string
  kind: Exclude<DatasetKind, 'vector'>
  source: ServiceSource
}

interface ServiceConnectPanelProps {
  /** Called only after user selects catalog entries — never dumps entire remote catalog. */
  onAddLayers: (layers: ServiceLayerAddRequest[]) => void
}

type ServiceChoice = OgcServiceType | 'auto'

export function ServiceConnectPanel({ onAddLayers }: ServiceConnectPanelProps) {
  const [url, setUrl] = useState('')
  const [service, setService] = useState<ServiceChoice>('auto')
  const [authMode, setAuthMode] = useState<ServiceAuthMode>('none')
  const [tokenParam, setTokenParam] = useState('token')
  const [tokenValue, setTokenValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState<ConnectServiceSuccess | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  // Changing description inputs invalidates in-flight / stale results.
  useEffect(() => {
    generationRef.current += 1
    setConnected(null)
    setSelected(new Set())
    setError(null)
    abortRef.current?.abort()
    abortRef.current = null
  }, [url, service, authMode, tokenParam, tokenValue])

  async function handleConnect(): Promise<void> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const generation = ++generationRef.current

    setLoading(true)
    setError(null)
    setConnected(null)
    setSelected(new Set())

    let auth: ConnectAuthForm = { mode: 'none' }
    if (authMode === 'query-token') {
      auth = { mode: 'query-token', param: tokenParam || 'token', token: tokenValue }
    } else if (authMode === 'bearer') {
      auth = { mode: 'bearer', token: tokenValue }
    }

    const result = await connectService({
      url,
      service,
      auth,
      signal: controller.signal,
      generation
    })

    if (generation !== generationRef.current) {
      // Stale — a newer description change superseded this request.
      return
    }

    setLoading(false)
    if (!result.ok) {
      setError(result.message)
      return
    }

    setConnected(result)
    // Do not auto-select all — first connect must not dump catalog into the project.
    setSelected(new Set())
  }

  function handleCancel(): void {
    abortRef.current?.abort()
    setLoading(false)
  }

  function toggleLayer(name: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function buildSource(
    layer: ServiceLayerInfo,
    conn: ConnectServiceSuccess
  ): ServiceLayerAddRequest | null {
    const desc = conn.description
    const authModeOut: ServiceAuthMode = conn.authMode
    const credentialRef = conn.credentialRefKey
      ? { key: conn.credentialRefKey }
      : undefined

    if (desc.service === 'WMS') {
      return {
        name: layer.title || layer.name,
        kind: 'wms',
        source: {
          type: 'wms',
          url: conn.shareableUrl,
          version: desc.version,
          layerNames: [layer.name],
          styleNames: layer.styles?.[0]?.name ? [layer.styles[0].name] : undefined,
          format: 'image/png',
          transparent: true,
          authMode: authModeOut,
          tokenParam: conn.tokenParam,
          credentialRef
        }
      }
    }

    if (desc.service === 'WMTS') {
      return {
        name: layer.title || layer.name,
        kind: 'wmts',
        source: {
          type: 'wmts',
          url: conn.shareableUrl,
          version: desc.version,
          layer: layer.name,
          style: layer.styles?.[0]?.name,
          format: 'image/png',
          tileMatrixSet: layer.crs?.[0] || desc.tileMatrixSets?.[0]?.identifier,
          authMode: authModeOut,
          tokenParam: conn.tokenParam,
          credentialRef
        }
      }
    }

    if (desc.service === 'WFS') {
      return {
        name: layer.title || layer.name,
        kind: 'wfs',
        source: {
          type: 'wfs',
          url: conn.shareableUrl,
          version: desc.version,
          typeName: layer.name,
          outputFormat: 'application/json',
          maxFeatures: 5000,
          authMode: authModeOut,
          tokenParam: conn.tokenParam,
          credentialRef
        }
      }
    }

    return null
  }

  function handleAddSelected(): void {
    if (!connected) return
    const requests: ServiceLayerAddRequest[] = []
    for (const layer of connected.selectable) {
      if (!selected.has(layer.name)) continue
      const req = buildSource(layer, connected)
      if (req) requests.push(req)
    }
    if (requests.length === 0) {
      setError('请至少选择一个图层 / 要素类型')
      return
    }
    onAddLayers(requests)
  }

  const persistHint = canPersistCredentialsSafely()
    ? '凭证将写入本机安全存储（仅引用写入项目）。'
    : '当前环境无法安全持久化 Token：仅保存在本次会话内存；项目中只保存 credential 引用。请勿把 Token 写进文件或日志。'

  return (
    <div className="service-connect-panel">
      <div className="service-connect-form">
        <label className="service-field">
          <span>服务 URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/geoserver/wms"
            autoComplete="off"
          />
        </label>

        <div className="service-field-row">
          <label className="service-field">
            <span>服务类型</span>
            <select
              value={service}
              onChange={(e) => setService(e.target.value as ServiceChoice)}
            >
              <option value="auto">自动检测</option>
              <option value="WMS">WMS</option>
              <option value="WMTS">WMTS</option>
              <option value="WFS">WFS</option>
            </select>
          </label>

          <label className="service-field">
            <span>认证</span>
            <select
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value as ServiceAuthMode)}
            >
              <option value="none">无认证</option>
              <option value="query-token">Query Token</option>
              <option value="bearer">Bearer Header</option>
            </select>
          </label>
        </div>

        {authMode === 'query-token' && (
          <div className="service-field-row">
            <label className="service-field">
              <span>Token 参数名</span>
              <input
                value={tokenParam}
                onChange={(e) => setTokenParam(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="service-field">
              <span>Token 值</span>
              <input
                type="password"
                value={tokenValue}
                onChange={(e) => setTokenValue(e.target.value)}
                autoComplete="off"
              />
            </label>
          </div>
        )}

        {authMode === 'bearer' && (
          <label className="service-field">
            <span>Bearer Token</span>
            <input
              type="password"
              value={tokenValue}
              onChange={(e) => setTokenValue(e.target.value)}
              autoComplete="off"
            />
          </label>
        )}

        {authMode !== 'none' && (
          <p className="service-auth-hint">{persistHint}</p>
        )}

        <div className="service-actions">
          <button
            className="button-primary"
            onClick={() => void handleConnect()}
            disabled={loading || !url.trim()}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="spin" /> 连接中…
              </>
            ) : (
              <>
                <Link2 size={14} /> 连接并读取 Capabilities
              </>
            )}
          </button>
          {loading && (
            <button className="button-secondary" onClick={handleCancel}>
              取消
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="import-error service-connect-error">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {connected && (
        <ServiceCatalog
          description={connected.description}
          selectable={connected.selectable}
          shareableUrl={connected.shareableUrl}
          selected={selected}
          onToggle={toggleLayer}
          onAdd={handleAddSelected}
        />
      )}
    </div>
  )
}

function ServiceCatalog({
  description,
  selectable,
  shareableUrl,
  selected,
  onToggle,
  onAdd
}: {
  description: ServiceDescription
  selectable: ServiceLayerInfo[]
  shareableUrl: string
  selected: Set<string>
  onToggle: (name: string) => void
  onAdd: () => void
}) {
  return (
    <div className="service-catalog">
      <div className="service-catalog-header">
        <h3>
          {description.service} {description.version}
          {description.title ? ` — ${description.title}` : ''}
        </h3>
        <p className="service-catalog-url" title={shareableUrl}>
          {shareableUrl}
        </p>
        <p className="config-hint">
          已读取远程目录（{selectable.length} 项）。只有勾选并确认后才会写入项目；连接本身不会添加图层。
        </p>
      </div>

      {selectable.length === 0 ? (
        <p className="config-hint">目录中没有可添加的命名图层 / 要素类型。</p>
      ) : (
        <div className="layer-list service-layer-list">
          {selectable.map((layer) => (
            <label key={layer.name} className="layer-checkbox-item">
              <input
                type="checkbox"
                checked={selected.has(layer.name)}
                onChange={() => onToggle(layer.name)}
              />
              <span>
                <strong>{layer.title || layer.name}</strong>
                {layer.title && layer.title !== layer.name ? (
                  <span className="service-layer-name"> ({layer.name})</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="service-catalog-footer">
        <button
          className="button-primary"
          onClick={onAdd}
          disabled={selected.size === 0}
        >
          添加选中的 {selected.size} 项到项目
        </button>
      </div>
    </div>
  )
}