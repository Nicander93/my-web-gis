import { useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import { useSessionStore } from '@/stores/session.store'
import { useProjectStore } from '@/stores/project.store'
import { isLegacyStyle } from '@desktop-webgis/gis-core'
import { StylePanel } from './StylePanel'
import { LabelPanel } from './LabelPanel'
import { Legend } from './Legend'

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
  const ensureStyleDraft = useSessionStore((state) => state.ensureStyleDraft)
  const setTab = useSessionStore((state) => state.setInspectorTab)

  const layerId = selectedLayerId || 'no-layer'
  const session = useSessionStore((state) => state.sessions[layerId] ?? {})
  const tab: InspectorTab = session.inspector?.activeTab ?? 'layer'

  const selectedLayer = selectedLayerId
    ? project.layers.find((layer) => layer.id === selectedLayerId)
    : null

  const featureCount = selectedLayer
    ? (featuresByDataset[selectedLayer.datasetId]?.length ?? 0)
    : 0

  const geometryType = selectedLayer ? getGeometryTypeName(selectedLayer.style) : 'Mixed'

  useEffect(() => {
    if (!selectedLayerId) return
    const applied = getNormalizedLayerStyle(selectedLayerId)
    if (applied) {
      ensureStyleDraft(selectedLayerId, applied)
    }
  }, [selectedLayerId, getNormalizedLayerStyle, ensureStyleDraft])

  return (
    <div className="feature-panel inspector-content">
      <div className="feature-heading">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h3>检查器</h3>
        </div>
      </div>
      <div className="segmented-tabs" role="tablist" aria-label="检查器类型">
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
        >
          样式
        </Button>
        <Button
          variant={tab === 'label' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'label')}
          role="tab"
          aria-selected={tab === 'label'}
        >
          标注
        </Button>
        <Button
          variant={tab === 'feature' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'feature')}
          role="tab"
          aria-selected={tab === 'feature'}
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
                <span>几何类型</span>
                <strong>{geometryType}</strong>
              </div>
              <div className="inspector-row">
                <span>要素数量</span>
                <strong>{featureCount}</strong>
              </div>
            </div>
            <Legend layerId={selectedLayerId} />
          </>
        ) : (
          <div className="empty-state empty-state-box">请选择一个图层</div>
        )
      ) : null}

      {tab === 'style' ? (
        selectedLayerId ? (
          <>
            <StylePanel layerId={selectedLayerId} />
            <Legend layerId={selectedLayerId} />
          </>
        ) : (
          <div className="empty-state empty-state-box">请选择一个图层</div>
        )
      ) : null}

      {tab === 'label' ? (
        selectedLayerId ? (
          <LabelPanel layerId={selectedLayerId} />
        ) : (
          <div className="empty-state empty-state-box">请选择一个图层</div>
        )
      ) : null}

      {tab === 'feature' ? (
        <div className="empty-state empty-state-box">请选择单个要素查看属性。</div>
      ) : null}
    </div>
  )
}
