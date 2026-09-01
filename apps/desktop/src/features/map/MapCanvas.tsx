import { Map, Plus, Minus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { mapCommands } from '@/app/commands/map.commands'

/** Workspace 的地图占位层，始终铺满容器并位于所有面板下方。 */
export function MapCanvas() {
  return (
    <section className="map-canvas" aria-label="地图工作区">
      <div className="map-grid" aria-hidden="true" />
      <div className="map-watermark">
        <Map size={22} strokeWidth={1.5} />
        <strong>MAP</strong>
        <span>地图运行时将在此接入</span>
      </div>
      <div className="map-controls" aria-label="地图导航">
        <Button variant="icon" title="放大" aria-label="放大" onClick={mapCommands.zoomIn}>
          <Plus size={15} />
        </Button>
        <Button variant="icon" title="缩小" aria-label="缩小" onClick={mapCommands.zoomOut}>
          <Minus size={15} />
        </Button>
      </div>
      <div className="map-readout">0.0000, 0.0000&nbsp;&nbsp;·&nbsp;&nbsp;1:0</div>
      <div className="map-tool-hint">选择工具 · 单击选择要素</div>
    </section>
  )
}
