import { isLegacyStyle, migrateLegacyStyle } from '@desktop-webgis/gis-core'
import { buildLegendItems, colorToString } from '@desktop-webgis/ol-style'
import { useProjectStore } from '@/stores/project.store'

interface LegendProps {
  layerId: string
}

/** 图例仅反映已应用配置，不读取草稿。 */
export function Legend({ layerId }: LegendProps) {
  const layer = useProjectStore((state) => state.project.layers.find((item) => item.id === layerId))

  if (!layer) {
    return null
  }

  const style = isLegacyStyle(layer.style) ? migrateLegacyStyle(layer.style) : layer.style
  const items = buildLegendItems(style)

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
