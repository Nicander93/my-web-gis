import { useLayerViewStore } from '@/view-state/layer-view.store'
import { ArrowDown, ArrowUp, Download, Eye, FileText, MapPinned, Trash2 } from 'lucide-react'
import { MenuItem } from '@/ui/MenuItem'
import { MenuSeparator } from '@/ui/MenuSeparator'
import { getLayerCapabilities, layerCommands } from '@/commands/layer.commands'
import { useProjectStore } from '@/session/project.store'

interface LayerMenuProps {
  onClose(): void
}

export function LayerMenu({ onClose }: LayerMenuProps) {
  const layerId = useLayerViewStore(state => state.selectedLayerId)
  useProjectStore(state => state.project)
  const caps = getLayerCapabilities(layerId)
  function handleAction(action: () => void) {
    action()
    onClose()
  }

  return (
    <div className="menu-content">
      <MenuItem
        icon={MapPinned}
        label="缩放到图层"
        disabled={!caps.canZoom}
        onClick={() => handleAction(layerCommands.zoomToLayer)}
      />
      <MenuSeparator />
      <MenuItem
        icon={ArrowUp}
        label="上移"
        disabled={!caps.exists}
        onClick={() => handleAction(layerCommands.moveUp)}
      />
      <MenuItem
        icon={ArrowDown}
        label="下移"
        disabled={!caps.exists}
        onClick={() => handleAction(layerCommands.moveDown)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Eye}
        label="编辑样式"
        disabled={!caps.canStyle}
        onClick={() => handleAction(layerCommands.editStyle)}
      />
      <MenuItem
        icon={FileText}
        label="属性表"
        disabled={!caps.canAttributeTable}
        onClick={() => handleAction(layerCommands.openAttributeTable)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Download}
        label="导出图层"
        disabled={!caps.canExport}
        onClick={() => handleAction(layerCommands.export)}
      />
      <MenuItem
        icon={Trash2}
        label="移除图层"
        disabled={!caps.canRemove}
        onClick={() => handleAction(layerCommands.remove)}
      />
    </div>
  )
}
