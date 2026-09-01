import { useState } from 'react'
import { Button } from '@/components/ui/Button'

type InspectorTab = 'layer' | 'feature'

/** Inspector 只负责展示检查器内容，不关心右侧面板布局。 */
export function Inspector() {
  const [tab, setTab] = useState<InspectorTab>('layer')

  return (
    <div className="feature-panel inspector-content">
      <div className="feature-heading">
        <div>
          <span className="eyebrow">INSPECTOR</span>
          <h3>检查器</h3>
        </div>
      </div>
      <div className="segmented-tabs" role="tablist" aria-label="检查器类型">
        <Button variant={tab === 'layer' ? 'tab' : 'ghost'} onClick={() => setTab('layer')} role="tab" aria-selected={tab === 'layer'}>
          图层属性
        </Button>
        <Button variant={tab === 'feature' ? 'tab' : 'ghost'} onClick={() => setTab('feature')} role="tab" aria-selected={tab === 'feature'}>
          要素属性
        </Button>
      </div>
      {tab === 'layer' ? (
        <div className="inspector-card">
          <div className="card-title">当前图层</div>
          <div className="inspector-row"><span>名称</span><strong>道路中心线</strong></div>
          <div className="inspector-row"><span>几何类型</span><strong>LineString</strong></div>
          <div className="inspector-row"><span>要素数量</span><strong>—</strong></div>
        </div>
      ) : (
        <div className="empty-state empty-state-box">请选择单个要素查看属性。</div>
      )}
      <div className="feature-note">Inspector 是否打开由用户主动决定，不因选择要素自动弹出。</div>
    </div>
  )
}
