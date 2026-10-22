import { getLayerCartography, isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'
import { buildLegendItems, colorToString } from '@desktop-webgis/ol-style'
import { buildCartographyLegendItems } from '@desktop-webgis/ol-style/cartography-model'
import { useProjectStore } from '@/stores/project.store'

interface LegendProps {
  layerId: string
}

/** 图例仅反映已应用配置，不读取草稿。 */
export function Legend({ layerId }: LegendProps) {
  const project = useProjectStore(state => state.project)
  const layer = project.layers.find(item => item.id === layerId)

  if (!layer) {
    return null
  }

  const style = isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : layer.style
  const fragment = getLayerCartography(project, layerId)
  let items: ReturnType<typeof buildLegendItems>
  try {
    items = fragment ? buildCartographyLegendItems(fragment.styleLayers) : buildLegendItems(style)
  } catch {
    return <div className="inspector-card legend-panel"><div className="card-title">图例</div><p>当前样式包含表达式或复合符号，无法用固定色块表示。</p></div>
  }

  return (
    <div className="inspector-card legend-panel">
      <div className="card-title">图例</div>
      <ul className="legend-list">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="legend-item">
            <span
              className={`legend-swatch legend-swatch-${item.kind}`}
              style={{ background: colorToString(item.color), borderColor: colorToString(item.color) }}
            />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
