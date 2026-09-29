import { Eye, EyeOff, Folder, GripVertical, Layers3, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useProjectStore } from '@/stores/project.store'
import { isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'
import { colorToString, symbolPrimaryColor, type LayerStyle, type Symbol } from '@desktop-webgis/ol-style'

function previewFromSymbol(symbol: Symbol): { kind: 'point' | 'line' | 'polygon'; color: string } {
  const color = colorToString(symbolPrimaryColor(symbol))
  if (symbol.type === 'circle') return { kind: 'point', color }
  if (symbol.type === 'solid' && 'width' in symbol && !('fill' in symbol)) return { kind: 'line', color }
  if (symbol.type === 'mixed') {
    if (symbol.polygon) return { kind: 'polygon', color }
    if (symbol.line) return { kind: 'line', color }
    return { kind: 'point', color }
  }
  return { kind: 'polygon', color }
}

function getPreviewSymbol(style: LayerStyle | { kind: string }): { kind: 'point' | 'line' | 'polygon'; color: string } {
  if (isLegacyStyle(style as never)) {
    const legacy = style as { kind: string; fill: string; stroke: string }
    if (legacy.kind === 'polygon') return { kind: 'polygon', color: legacy.fill }
    if (legacy.kind === 'line') return { kind: 'line', color: legacy.stroke }
    return { kind: 'point', color: legacy.fill }
  }

  const normalized = style as LayerStyle
  if (normalized.mode === 'single') {
    return previewFromSymbol(normalized.symbol)
  }
  if (normalized.mode === 'categorized') {
    return previewFromSymbol(normalized.categories[0]?.symbol ?? normalized.fallback)
  }
  return previewFromSymbol(normalized.breaks[0]?.symbol ?? normalized.fallback)
}

export function LayerPanel() {
  const [query, setQuery] = useState('')
  const projectLayers = useProjectStore((state) => state.project.layers)
  const selectedLayerId = useProjectStore((state) => state.selectedLayerId)
  const setSelectedLayer = useProjectStore((state) => state.setSelectedLayer)

  const [visible, setVisible] = useState<Record<string, boolean>>({})

  const filteredLayers = projectLayers.filter((layer) => layer.name.includes(query.trim()))

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
          const style = isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : layer.style
          const preview = getPreviewSymbol(style)

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
                <span
                  className={`layer-symbol layer-symbol-${preview.kind}`}
                  style={
                    preview.kind === 'polygon'
                      ? { background: preview.color, borderColor: preview.color }
                      : { background: preview.color }
                  }
                />
                <span>{layer.name}</span>
              </button>
            </div>
          )
        })}
        {filteredLayers.length === 0 && projectLayers.length === 0 && (
          <p className="empty-state">暂无图层，请通过&quot;添加数据&quot;导入</p>
        )}
        {filteredLayers.length === 0 && projectLayers.length > 0 && (
          <p className="empty-state">没有匹配的图层</p>
        )}
      </div>
    </div>
  )
}
