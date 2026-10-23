import { useEffect } from 'react'
import { Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useSessionStore } from '@/stores/session.store'
import { useProjectStore } from '@/stores/project.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { layerCommands } from '@/app/commands/layer.commands'
import { capabilitiesForDataset } from '@desktop-webgis/gis-core'
import { StylePanel } from './StylePanel'
import { LabelPanel } from './LabelPanel'
import { Legend } from './Legend'
import { getLayerCapabilities } from '@/app/commands/layer.commands'
import { PopupFields } from './PopupFields'
import { openPropertyWindow } from './property-window-request'

type InspectorTab = 'layer' | 'style' | 'label'

export function Inspector() {
  const selectedLayerId = useWorkbenchStore((state) => state.inspectorLayerId)
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  const setLayerOpacity = useProjectStore((state) => state.setLayerOpacity)
  const setTab = useSessionStore((state) => state.setInspectorTab)

  const layerId = selectedLayerId || 'no-layer'
  const session = useSessionStore((state) => state.sessions[layerId])
  const tab: InspectorTab = session?.inspector?.activeTab === 'feature' ? 'layer' : session?.inspector?.activeTab ?? 'layer'

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

  const flags = capabilitiesForDataset(dataset)


  // Service tile layers have no local attributes — keep users on the layer tab.
  useEffect(() => {
    if (!selectedLayerId) return
    if (flags.queryAttributes) return
    if (tab === 'style' || tab === 'label') {
      setTab(selectedLayerId, 'layer')
    }
  }, [selectedLayerId, flags.queryAttributes, tab, setTab])

  return (
    <div className="feature-panel inspector-content">
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
      </div>

      {tab === 'layer' ? (
        selectedLayer && selectedLayerId ? (
          <>
            <div className="inspector-card">
              <div className="card-title">图层概览</div>
              <div className="inspector-row">
                <span>名称</span>
                <strong>{selectedLayer.name}</strong>
              </div>
              <div className="inspector-row">
                <span>数据源</span>
                <strong>
                  {dataset
                    ? {
                        vector: '本地矢量',
                        wfs: 'WFS 只读快照',
                        wms: 'WMS 影像',
                        wmts: 'WMTS 瓦片'
                      }[dataset.kind]
                    : '—'}
                </strong>
              </div>
              {dataset && <div className="inspector-row"><span>状态</span><strong>{dataset.kind === 'wms' || dataset.kind === 'wmts' ? '服务影像' : dataset.kind === 'wfs' ? `只读快照 · ${featureCount} 条` : `本地要素 · ${featureCount} 条`}</strong></div>}
              {flags.queryAttributes && (
                <label className="inspector-row" title="限制地图点击与框选；属性表仍可选择记录和定位。">
                  <span>地图可选择</span>
                  <input type="checkbox" checked={selectedLayer.interaction?.selectable !== false}
                    onChange={event => layerCommands.setSelectable(selectedLayer.id, event.target.checked)} />
                </label>
              )}
              {flags.queryAttributes && <PopupFields layerId={selectedLayer.id} popup={selectedLayer.interaction?.popup}
                fields={[...new Set([...(dataset?.fields?.map(field => field.name) ?? []), ...(featuresByDataset[selectedLayer.datasetId] ?? []).slice(0, 100).flatMap(feature => Object.keys(feature.properties))])]} />}
              <Button variant="ghost" onClick={() => openPropertyWindow({ kind: 'layer', id: selectedLayer.id })}>完整属性…</Button>
              <div className="inspector-row inspector-opacity-row">
                <span>不透明度</span>
                <label className="inspector-opacity">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(selectedLayer.opacity * 100)}
                    onChange={(e) =>
                      setLayerOpacity(
                        selectedLayerId,
                        Number(e.target.value) / 100
                      )
                    }
                  />
                  <strong>{Math.round(selectedLayer.opacity * 100)}%</strong>
                </label>
              </div>
            </div>
            {caps.canStyle ? (
              <details className="property-section">
                <summary>图例预览</summary>
                <Legend layerId={selectedLayerId} />
              </details>
            ) : null}
          </>
        ) : (
          <div className="workbench-empty">
            <Settings2 size={24} />
            <strong>选择配置对象</strong>
            <p>从图层的更多菜单打开属性、样式或标注。</p>
          </div>
        )
      ) : null}

      {tab === 'style' ? (
        selectedLayerId && caps.canStyle ? (
          <>
            <StylePanel layerId={selectedLayerId} />
            <details className="property-section">
              <summary>图例预览</summary>
              <Legend layerId={selectedLayerId} />
            </details>
          </>
        ) : (
          <div className="empty-state empty-state-box">
            {caps.canStyle
              ? '请选择一个图层'
              : caps.isService
                ? '服务影像图层不支持矢量样式面板'
                : '请选择一个图层'}
          </div>
        )
      ) : null}

      {tab === 'label' ? (
        selectedLayerId && caps.canLabel ? (
          <LabelPanel layerId={selectedLayerId} />
        ) : (
          <div className="empty-state empty-state-box">
            {caps.canLabel
              ? '请选择一个图层'
              : caps.isService
                ? '服务影像图层不支持标注面板'
                : '请选择一个图层'}
          </div>
        )
      ) : null}

    </div>
  )
}
