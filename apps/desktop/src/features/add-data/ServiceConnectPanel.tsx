import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Link2, Loader2 } from 'lucide-react'
import type { OgcServiceType, ServiceDescription, ServiceLayerInfo, WmtsRequestEncoding } from '@desktop-webgis/ogc-io'
import {
  listCompatibleTileMatrixSets,
  resolveWmtsLayerOptions,
  pickWfsOutputFormat,
  clampWfsMaxFeatures,
  WFS_DEFAULT_MAX_FEATURES,
  WFS_PHASE_MAX_FEATURES
} from '@desktop-webgis/ogc-io'
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
  /** Present for WFS adds so App can kick off a bounded snapshot load. */
  wfsLoad?: {
    description: ServiceDescription
    extentMode: 'view' | 'full'
    maxFeatures: number
    authMode: ServiceAuthMode
    tokenParam?: string
    credentialRefKey?: string
  }
}

interface ServiceConnectPanelProps {
  /** Called only after user selects catalog entries — never dumps entire remote catalog. */
  onAddLayers: (layers: ServiceLayerAddRequest[]) => void
}

type ServiceChoice = OgcServiceType | 'auto'

function pickPreferredCrs(crsList: string[] | undefined): string | undefined {
  if (!crsList?.length) return undefined
  const normalized = crsList.map((c) => c.trim())
  return (
    normalized.find((c) => /EPSG:3857$/i.test(c)) ||
    normalized.find((c) => /EPSG:4326$/i.test(c)) ||
    normalized[0]
  )
}

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
  /** Per-layer selected style name (WMS). */
  const [styleByLayer, setStyleByLayer] = useState<Record<string, string>>({})
  /** Per-layer WMTS format / TileMatrixSet / encoding. */
  const [wmtsOptsByLayer, setWmtsOptsByLayer] = useState<
    Record<string, { format: string; tileMatrixSet: string; requestEncoding: WmtsRequestEncoding }>
  >({})
  const [wfsExtentMode, setWfsExtentMode] = useState<'view' | 'full'>('view')
  const [wfsMaxFeatures, setWfsMaxFeatures] = useState(WFS_DEFAULT_MAX_FEATURES)
  const generationRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    generationRef.current += 1
    setConnected(null)
    setSelected(new Set())
    setStyleByLayer({})
    setWmtsOptsByLayer({})
    setWfsExtentMode('view')
    setWfsMaxFeatures(WFS_DEFAULT_MAX_FEATURES)
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
    setStyleByLayer({})
    setWmtsOptsByLayer({})
    setWfsExtentMode('view')
    setWfsMaxFeatures(WFS_DEFAULT_MAX_FEATURES)

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
      return
    }

    setLoading(false)
    if (!result.ok) {
      setError(result.message)
      return
    }

    setConnected(result)
    const defaults: Record<string, string> = {}
    const wmtsDefaults: Record<
      string,
      { format: string; tileMatrixSet: string; requestEncoding: WmtsRequestEncoding }
    > = {}
    for (const layer of result.selectable) {
      const preferredStyle =
        layer.styles?.find((s) => s.isDefault)?.name || layer.styles?.[0]?.name
      if (preferredStyle) defaults[layer.name] = preferredStyle
      if (result.description.service === 'WMTS') {
        const resolved = resolveWmtsLayerOptions(result.description, {
          layer: layer.name,
          preferredCrs: 'EPSG:3857'
        })
        if (resolved.ok) {
          wmtsDefaults[layer.name] = {
            format: resolved.options.format,
            tileMatrixSet: resolved.options.tileMatrixSet,
            requestEncoding: resolved.options.requestEncoding
          }
        } else {
          const sets = listCompatibleTileMatrixSets(result.description, layer.name)
          const first = sets.find((s) => s.compatible) ?? sets[0]
          wmtsDefaults[layer.name] = {
            format: layer.formats?.[0] || 'image/png',
            tileMatrixSet: first?.identifier || '',
            requestEncoding: (result.description.wmtsRequestEncodings?.[0] || 'KVP') as WmtsRequestEncoding
          }
        }
      }
    }
    setStyleByLayer(defaults)
    setWmtsOptsByLayer(wmtsDefaults)
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
      const styleName = styleByLayer[layer.name] || layer.styles?.[0]?.name
      return {
        name: layer.title || layer.name,
        kind: 'wms',
        source: {
          type: 'wms',
          url: conn.shareableUrl,
          version: desc.version,
          layerNames: [layer.name],
          styleNames: styleName ? [styleName] : undefined,
          format: 'image/png',
          transparent: true,
          crs: pickPreferredCrs(layer.crs),
          bboxWgs84: layer.bboxWgs84,
          authMode: authModeOut,
          tokenParam: conn.tokenParam,
          credentialRef
        }
      }
    }

    if (desc.service === 'WMTS') {
      const opts = wmtsOptsByLayer[layer.name]
      const resolved = resolveWmtsLayerOptions(desc, {
        layer: layer.name,
        style: styleByLayer[layer.name] || layer.styles?.[0]?.name,
        format: opts?.format,
        tileMatrixSet: opts?.tileMatrixSet,
        requestEncoding: opts?.requestEncoding,
        preferredCrs: 'EPSG:3857'
      })
      if (!resolved.ok) {
        setError(resolved.reason)
        return null
      }
      return {
        name: layer.title || layer.name,
        kind: 'wmts',
        source: {
          type: 'wmts',
          url: resolved.options.urls[0] || conn.shareableUrl,
          version: desc.version,
          layer: resolved.options.layer,
          style: resolved.options.style,
          format: resolved.options.format,
          tileMatrixSet: resolved.options.tileMatrixSet,
          requestEncoding: resolved.options.requestEncoding,
          urls: resolved.options.urls,
          projection: resolved.options.projection,
          supportedCrs: resolved.options.supportedCrs,
          bboxWgs84: resolved.options.bboxWgs84,
          tileMatrices: resolved.options.tileMatrices,
          authMode: authModeOut,
          tokenParam: conn.tokenParam,
          credentialRef
        }
      }
    }

    if (desc.service === 'WFS') {
      const format = pickWfsOutputFormat(
        layer.outputFormats?.length ? layer.outputFormats : desc.wfsOutputFormats
      )
      const maxFeatures = clampWfsMaxFeatures(wfsMaxFeatures)
      return {
        name: layer.title || layer.name,
        kind: 'wfs',
        source: {
          type: 'wfs',
          url: conn.shareableUrl,
          version: desc.version,
          typeName: layer.name,
          outputFormat: format.value,
          maxFeatures,
          srsName: layer.defaultCrs || layer.crs?.[0],
          bboxWgs84: layer.bboxWgs84,
          extentMode: wfsExtentMode,
          complete: false,
          loadedCount: 0,
          authMode: authModeOut,
          tokenParam: conn.tokenParam,
          credentialRef
        },
        wfsLoad: {
          description: desc,
          extentMode: wfsExtentMode,
          maxFeatures,
          authMode: authModeOut,
          tokenParam: conn.tokenParam,
          credentialRefKey: conn.credentialRefKey
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
    ? '凭证将写入本机安全存储，不会写入项目文件。'
    : '当前环境无法安全持久化 Token：密钥仅保存在本会话内存；项目里只保存 credential 引用。请勿把 Token 写入文件或日志。'

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
          styleByLayer={styleByLayer}
          wmtsOptsByLayer={wmtsOptsByLayer}
            wfsExtentMode={wfsExtentMode}
            wfsMaxFeatures={wfsMaxFeatures}
            onWfsExtentModeChange={setWfsExtentMode}
            onWfsMaxFeaturesChange={(n) => setWfsMaxFeatures(clampWfsMaxFeatures(n))}
          onToggle={toggleLayer}
          onStyleChange={(name, style) =>
            setStyleByLayer((prev) => ({ ...prev, [name]: style }))
          }
          onWmtsOptsChange={(name, patch) =>
            setWmtsOptsByLayer((prev) => ({
              ...prev,
              [name]: {
                ...(prev[name] ?? {
                  format: 'image/png',
                  tileMatrixSet: '',
                  requestEncoding: 'KVP'
                }),
                ...patch
              }
            }))
          }
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
  styleByLayer,
  wmtsOptsByLayer,
  wfsExtentMode,
  wfsMaxFeatures,
  onToggle,
  onStyleChange,
  onWmtsOptsChange,
  onWfsExtentModeChange,
  onWfsMaxFeaturesChange,
  onAdd
}: {
  description: ServiceDescription
  selectable: ServiceLayerInfo[]
  shareableUrl: string
  selected: Set<string>
  styleByLayer: Record<string, string>
  wmtsOptsByLayer: Record<
    string,
    { format: string; tileMatrixSet: string; requestEncoding: WmtsRequestEncoding }
  >
  wfsExtentMode: 'view' | 'full'
  wfsMaxFeatures: number
  onToggle: (name: string) => void
  onStyleChange: (name: string, style: string) => void
  onWmtsOptsChange: (
    name: string,
    patch: Partial<{ format: string; tileMatrixSet: string; requestEncoding: WmtsRequestEncoding }>
  ) => void
  onWfsExtentModeChange: (mode: 'view' | 'full') => void
  onWfsMaxFeaturesChange: (n: number) => void
  onAdd: () => void
}) {
  const isWms = description.service === 'WMS'
  const isWmts = description.service === 'WMTS'
  const isWfs = description.service === 'WFS'
  const encodings = description.wmtsRequestEncodings ?? []
  const wfsFormats = description.wfsOutputFormats ?? []
  const wfsPaging = description.wfsPaging?.supported

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
          已读取远程目录（{selectable.length} 项）。只有勾选并确认后才会写入项目；连接本身不创建图层。
          {isWmts
            ? ' WMTS 使用 Capabilities 声明的 TileMatrix（origin / resolution / matrix ID / tile size），不会硬编码成 XYZ。'
            : ''}
          {isWfs
            ? ' WFS 加载为只读本地快照（默认上限 5000，阶段保护上限 50000）；截断不会标为完整；刷新失败保留原快照；不启用 WFS-T。'
            : ''}
        </p>
      </div>

      {selectable.length === 0 ? (
        <p className="config-hint">目录中没有可添加的命名图层 / 要素类型。</p>
      ) : (
        <div className="layer-list service-layer-list">
          {selectable.map((layer) => {
            const matrixSets = isWmts
              ? listCompatibleTileMatrixSets(description, layer.name)
              : []
            const wmtsOpts = wmtsOptsByLayer[layer.name]
            const selectedSet = matrixSets.find((s) => s.identifier === wmtsOpts?.tileMatrixSet)
            const matrixWarning =
              selectedSet && !selectedSet.compatible ? selectedSet.reason : undefined

            return (
              <div key={layer.name} className="service-layer-row">
                <label className="layer-checkbox-item">
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
                <div className="service-layer-meta">
                  {isWmts ? (
                    <span title={matrixSets.map((s) => s.identifier).join(', ')}>
                      TMS: {matrixSets.map((s) => s.identifier).slice(0, 2).join(', ') || '—'}
                      {matrixSets.length > 2 ? ` +${matrixSets.length - 2}` : ''}
                    </span>
                  ) : layer.crs?.length ? (
                    <span title={layer.crs.join(', ')}>
                      CRS: {layer.crs.slice(0, 3).join(', ')}
                      {layer.crs.length > 3 ? ` +${layer.crs.length - 3}` : ''}
                    </span>
                  ) : (
                    <span>CRS: —</span>
                  )}
                  {layer.bboxWgs84 ? (
                    <span>
                      Extent: {layer.bboxWgs84.map((n) => n.toFixed(1)).join(', ')}
                    </span>
                  ) : null}
                  {(isWms || isWmts) && layer.styles && layer.styles.length > 0 ? (
                    <label className="service-style-pick">
                      <span>样式</span>
                      <select
                        value={styleByLayer[layer.name] || layer.styles[0]!.name}
                        onChange={(e) => onStyleChange(layer.name, e.target.value)}
                        disabled={!selected.has(layer.name)}
                      >
                        {layer.styles.map((style) => (
                          <option key={style.name} value={style.name}>
                            {style.title || style.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {isWmts && layer.formats && layer.formats.length > 0 ? (
                    <label className="service-style-pick">
                      <span>格式</span>
                      <select
                        value={wmtsOpts?.format || layer.formats[0]!}
                        onChange={(e) => onWmtsOptsChange(layer.name, { format: e.target.value })}
                        disabled={!selected.has(layer.name)}
                      >
                        {layer.formats.map((format) => (
                          <option key={format} value={format}>
                            {format}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {isWmts && matrixSets.length > 0 ? (
                    <label className="service-style-pick">
                      <span>TileMatrixSet</span>
                      <select
                        value={wmtsOpts?.tileMatrixSet || matrixSets[0]!.identifier}
                        onChange={(e) =>
                          onWmtsOptsChange(layer.name, { tileMatrixSet: e.target.value })
                        }
                        disabled={!selected.has(layer.name)}
                      >
                        {matrixSets.map((set) => (
                          <option key={set.identifier} value={set.identifier}>
                            {set.identifier}
                            {set.supportedCrs ? ` (${set.supportedCrs})` : ''}
                            {!set.compatible ? ' — 不可用' : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {isWmts && encodings.length > 1 ? (
                    <label className="service-style-pick">
                      <span>编码</span>
                      <select
                        value={wmtsOpts?.requestEncoding || encodings[0]!}
                        onChange={(e) =>
                          onWmtsOptsChange(layer.name, {
                            requestEncoding: e.target.value as WmtsRequestEncoding
                          })
                        }
                        disabled={!selected.has(layer.name)}
                      >
                        {encodings.map((enc) => (
                          <option key={enc} value={enc}>
                            {enc}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : isWmts && encodings.length === 1 ? (
                    <span>编码: {encodings[0]}</span>
                  ) : null}
                  {matrixWarning ? (
                    <span className="service-matrix-warning" title={matrixWarning}>
                      {matrixWarning}
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {isWfs ? (
        <div className="service-wfs-options">
          <label className="service-field">
            <span>加载范围</span>
            <select
              value={wfsExtentMode}
              onChange={(e) => onWfsExtentModeChange(e.target.value as 'view' | 'full')}
            >
              <option value="view">当前视图范围</option>
              <option value="full">要素类型全范围（无 BBOX 时不限范围）</option>
            </select>
          </label>
          <label className="service-field">
            <span>要素上限（默认 {WFS_DEFAULT_MAX_FEATURES}，最大 {WFS_PHASE_MAX_FEATURES}）</span>
            <input
              type="number"
              min={1}
              max={WFS_PHASE_MAX_FEATURES}
              value={wfsMaxFeatures}
              onChange={(e) => onWfsMaxFeaturesChange(Number(e.target.value))}
            />
          </label>
          <p className="config-hint">
            输出格式优先 GeoJSON
            {wfsFormats.length ? `（声明: ${wfsFormats.slice(0, 3).join(', ')}）` : ''}
            ；分页{wfsPaging ? '已启用（Capabilities 声明支持）' : '未声明，将单次请求上限条数'}。
          </p>
        </div>
      ) : null}

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
