import { Eye, EyeOff, Folder, GripVertical, Layers3, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useProjectStore } from '@/stores/project.store'

export function LayerPanel() {
  const [query, setQuery] = useState('')
  const projectLayers = useProjectStore((state) => state.project.layers)
  const selectedLayerId = useProjectStore((state) => state.selectedLayerId)
  const setSelectedLayer = useProjectStore((state) => state.setSelectedLayer)
  
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  
  const filteredLayers = projectLayers.filter((layer) => 
    layer.name.includes(query.trim())
  )

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
        {filteredLayers.map((layer) => {
          const isVisible = visible[layer.id] ?? layer.visible
          const isActive = selectedLayerId === layer.id
          const symbolClass = layer.style.kind === 'polygon' ? 'polygon' : 
                             layer.style.kind === 'line' ? 'line' : 'point'
          
          return (
            <div key={layer.id} className={`layer-item ${isActive ? 'is-active' : ''}`}>
              <GripVertical className="drag-icon" size={13} />
              <Button
                variant="icon"
                className="visibility-button"
                title={isVisible ? '隐藏图层' : '显示图层'}
                aria-label={isVisible ? `隐藏${layer.name}` : `显示${layer.name}`}
                onClick={() => setVisible((state) => ({ ...state, [layer.id]: !isVisible }))}
              >
                {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
              </Button>
              <button 
                className="layer-name-button" 
                type="button" 
                onClick={() => setSelectedLayer(layer.id)}
              >
                <span className={`layer-symbol layer-symbol-${symbolClass}`} />
                <span>{layer.name}</span>
              </button>
            </div>
          )
        })}
        {filteredLayers.length === 0 && projectLayers.length === 0 && (
          <p className="empty-state">暂无图层，请通过"添加数据"导入</p>
        )}
        {filteredLayers.length === 0 && projectLayers.length > 0 && (
          <p className="empty-state">没有匹配的图层</p>
        )}
      </div>
    </div>
  )
}
