import { Eye, EyeOff, Folder, GripVertical, Layers3, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'

const sampleLayers = ['道路中心线', '水系', '行政区划']

/** Layer Manager 只描述图层业务，不感知自己位于哪个面板。 */
export function LayerPanel() {
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sampleLayers.map((name) => [name, true]))
  )
  const [activeLayer, setActiveLayer] = useState(sampleLayers[0])
  const layers = sampleLayers.filter((name) => name.includes(query.trim()))

  return (
    <div className="feature-panel layer-manager">
      <div className="feature-heading">
        <div>
          <span className="eyebrow">LAYER MANAGER</span>
          <h3>图层</h3>
        </div>
        <Button variant="icon" title="图层选项" aria-label="图层选项">
          <Layers3 size={15} />
        </Button>
      </div>
      <label className="search-field">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索图层" />
      </label>
      <div className="layer-tree">
        <div className="tree-root">
          <Folder size={14} />
          <span>工作空间</span>
        </div>
        {layers.map((name) => (
          <div key={name} className={`layer-item ${activeLayer === name ? 'is-active' : ''}`}>
            <GripVertical className="drag-icon" size={13} />
            <Button
              variant="icon"
              className="visibility-button"
              title={visible[name] ? '隐藏图层' : '显示图层'}
              aria-label={visible[name] ? `隐藏${name}` : `显示${name}`}
              onClick={() => setVisible((state) => ({ ...state, [name]: !state[name] }))}
            >
              {visible[name] ? <Eye size={14} /> : <EyeOff size={14} />}
            </Button>
            <button className="layer-name-button" type="button" onClick={() => setActiveLayer(name)}>
              <span className={`layer-symbol layer-symbol-${name === '行政区划' ? 'polygon' : name === '水系' ? 'line' : 'point'}`} />
              <span>{name}</span>
            </button>
          </div>
        ))}
        {layers.length === 0 && <p className="empty-state">没有匹配的图层</p>}
      </div>
      <div className="feature-note">第一阶段仅建立图层管理器容器，GIS 图层服务将在后续接入。</div>
    </div>
  )
}
