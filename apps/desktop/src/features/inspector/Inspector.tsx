import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { useSessionStore } from '@/stores/session.store'
import { useProjectStore } from '@/stores/project.store'
import { capabilitiesForDataset, isLegacyStyle } from '@desktop-webgis/gis-core'
import { StylePanel } from './StylePanel'
import { LabelPanel } from './LabelPanel'
import { Legend } from './Legend'
import { getLayerCapabilities } from '@/app/commands/layer.commands'

type InspectorTab = 'layer' | 'feature' | 'style' | 'label'

function getGeometryTypeName(style: unknown): string {
  if (isLegacyStyle(style as never)) {
    const legacy = style as { kind: string }
    if (legacy.kind === 'point') return 'Point'
    if (legacy.kind === 'line') return 'LineString'
    if (legacy.kind === 'polygon') return 'Polygon'
    return 'Mixed'
  }
  return 'Mixed'
}

export function Inspector() {
  const selectedLayerId = useProjectStore((state) => state.selectedLayerId)
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const getNormalizedLayerStyle = useProjectStore((state) => state.getNormalizedLayerStyle)
  const setLayerOpacity = useProjectStore((state) => state.setLayerOpacity)
  const ensureStyleDraft = useSessionStore((state) => state.ensureStyleDraft)
  const setTab = useSessionStore((state) => state.setInspectorTab)

  const layerId = selectedLayerId || 'no-layer'
  const session = useSessionStore((state) => state.sessions[layerId] ?? {})
  const tab: InspectorTab = session.inspector?.activeTab ?? 'layer'

  const selectedLayer = selectedLayerId
    ? project.layers.find((layer) => layer.id === selectedLayerId)
    : null

  const dataset = selectedLayer
    ? project.datasets.find((item) => item.id === selectedLayer.datasetId)
    : undefined
  const caps = getLayerCapabilities(selectedLayerId)
  const featureCount = selectedLayer
    ? (featuresByDataset[selectedLayer.datasetId]?.length ?? 0)
    : 0

  const geometryType = selectedLayer ? getGeometryTypeName(selectedLayer.style) : 'Mixed'
  const flags = capabilitiesForDataset(dataset)

  useEffect(() => {
    if (!selectedLayerId) return
    if (!flags.style) return
    const applied = getNormalizedLayerStyle(selectedLayerId)
    if (applied) {
      ensureStyleDraft(selectedLayerId, applied)
    }
  }, [selectedLayerId, getNormalizedLayerStyle, ensureStyleDraft, flags.style])

  // Service tile layers have no local attributes — keep users on the layer tab.
  useEffect(() => {
    if (!selectedLayerId) return
    if (flags.queryAttributes) return
    if (tab === 'feature' || tab === 'style' || tab === 'label') {
      setTab(selectedLayerId, 'layer')
    }
  }, [selectedLayerId, flags.queryAttributes, tab, setTab])

  return (
    <div className="feature-panel inspector-content">
      <div className="feature-heading">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h3>检查器</h3>
        </div>
      </div>
      <div className="segmented-tabs" role="tablist" aria-label="检查器标签">
        <Button
          variant={tab === 'layer' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'layer')}
          role="tab"
          aria-selected={tab === 'layer'}
        >
          图层
        </Button>
        <Button
          variant={tab === 'style' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'style')}
          role="tab"
          aria-selected={tab === 'style'}
          disabled={!caps.canStyle}
        >
          样式
        </Button>
        <Button
          variant={tab === 'label' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'label')}
          role="tab"
          aria-selected={tab === 'label'}
          disabled={!caps.canLabel}
        >
          标注
        </Button>
        <Button
          variant={tab === 'feature' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'feature')}
          role="tab"
          aria-selected={tab === 'feature'}
          disabled={!caps.canAttributeTable}
        >
          要素
        </Button>
      </div>

      {tab === 'layer' ? (
        selectedLayer && selectedLayerId ? (
          <>
            <div className="inspector-card">
              <div className="card-title">当前图层</div>
              <div className="inspector-row">
                <span>名称</span>
                <strong>{selectedLayer.name}</strong>
              </div>
              <div className="inspector-row">
                <span>数据源</span>
                <strong>{dataset?.kind ?? '—'}</strong>
              </div>
              {dataset?.kind === 'wms' ? (
                <>
                  <div className="inspector-row">
                    <span>WMS 版本</span>
                    <strong>{dataset.source.version}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>图层名</span>
                    <strong>{dataset.source.layerNames.join(', ')}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>CRS</span>
                    <strong>{dataset.source.crs || '视图默认'}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>范围</span>
                    <strong>
                      {dataset.source.bboxWgs84
                        ? dataset.source.bboxWgs84.map((n) => n.toFixed(2)).join(', ')
                        : '—'}
                    </strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="inspector-row">
                    <span>几何类型</span>
                    <strong>{geometryType}</strong>
                  </div>
                  <div className="inspector-row">
                    <span>要素数量</span>
                    <strong>{featureCount}</strong>
                  </div>
                </>
              )}
              <div className="inspector-row inspector-opacity-row">
                <span>透明度</span>
                <label className="inspector-opacity">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(selectedLayer.opacity * 100)}
                    onChange={(e) =>
                      setLayerOpacity(selectedLayerId, Number(e.target.value) / 100)
                    }
                  />
                  <strong>{Math.round(selectedLayer.opacity * 100)}%</strong>
                </label>
              </div>
            </div>
            {caps.canStyle ? <Legend layerId={selectedLayerId} /> : null}
            {dataset?.kind === 'wms' ? (
              <p className="config-hint">
                WMS 为影像服务图层，不提供本地矢量属性表；GetFeatureInfo 不在本阶段范围。
              </p>
            ) : null}
          </>
        ) : (
          <div className="empty-state empty-state-box">请选择一个图层</div>
        )
      ) : null}

      {tab === 'style' ? (
        selectedLayerId && caps.canStyle ? (
          <>
            <StylePanel layerId={selectedLayerId} />
            <Legend layerId={selectedLayerId} />
          </>
        ) : (
          <div className="empty-state empty-state-box">
            {caps.isService ? '服务影像图层不支持矢量样式面板' : '请选择一个图层'}
          </div>
        )
      ) : null}

      {tab === 'label' ? (
        selectedLayerId && caps.canLabel ? (
          <LabelPanel layerId={selectedLayerId} />
        ) : (
          <div className="empty-state empty-state-box">
            {caps.isService ? '服务影像图层不支持标注面板' : '请选择一个图层'}
          </div>
        )
      ) : null}

      {tab === 'feature' ? (
        <div className="empty-state empty-state-box">
          {caps.canAttributeTable
            ? '请选择单个要素查看属性。'
            : '当前图层没有可查询的本地要素属性（WMS/WMTS 不假装提供属性表）。'}
        </div>
      ) : null}
    </div>
  )
}
