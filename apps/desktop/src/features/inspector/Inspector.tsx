import { Button } from '@/components/ui/Button'
import { useSessionStore } from '@/stores/session.store'
import { useProjectStore } from '@/stores/project.store'

type InspectorTab = 'layer' | 'feature'

export function Inspector() {
  const selectedLayerId = useProjectStore((state) => state.selectedLayerId)
  const project = useProjectStore((state) => state.project)
  const featuresByDataset = useProjectStore((state) => state.featuresByDataset)
  
  const layerId = selectedLayerId || 'no-layer'
  const session = useSessionStore((state) => state.getLayerSession(layerId))
  const setTab = useSessionStore((state) => state.setInspectorTab)
  const tab = session.inspector?.activeTab ?? 'layer'
  
  const selectedLayer = selectedLayerId 
    ? project.layers.find(l => l.id === selectedLayerId)
    : null
  
  const featureCount = selectedLayer
    ? (featuresByDataset[selectedLayer.datasetId]?.length ?? 0)
    : 0
  
  const geometryType = selectedLayer?.style.kind === 'point' ? 'Point' :
                       selectedLayer?.style.kind === 'line' ? 'LineString' :
                       selectedLayer?.style.kind === 'polygon' ? 'Polygon' : 'Mixed'

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
          图层属性
        </Button>
        <Button
          variant={tab === 'feature' ? 'tab' : 'ghost'}
          onClick={() => setTab(layerId, 'feature')}
          role="tab"
          aria-selected={tab === 'feature'}
        >
          要素属性
        </Button>
      </div>
      {tab === 'layer' ? (
        selectedLayer ? (
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
        ) : (
          <div className="empty-state empty-state-box">请选择一个图层</div>
        )
      ) : (
        <div className="empty-state empty-state-box">请选择单个要素查看属性。</div>
      )}
    </div>
  )
}
