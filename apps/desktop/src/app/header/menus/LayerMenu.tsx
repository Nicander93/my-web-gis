import { ArrowDown, ArrowUp, Download, Eye, FileText, MapPinned, Trash2 } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { MenuSeparator } from './MenuSeparator'
import { layerCommands } from '@/app/commands/layer.commands'

interface LayerMenuProps {
  onClose(): void
}

export function LayerMenu({ onClose }: LayerMenuProps) {
  function handleAction(action: () => void) {
    action()
    onClose()
  }

  return (
    <div className="menu-content">
      <MenuItem
        icon={MapPinned}
        label="缩放到图层"
        onClick={() => handleAction(layerCommands.zoomToLayer)}
      />
      <MenuSeparator />
      <MenuItem
        icon={ArrowUp}
        label="上移"
        onClick={() => handleAction(layerCommands.moveUp)}
      />
      <MenuItem
        icon={ArrowDown}
        label="下移"
        onClick={() => handleAction(layerCommands.moveDown)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Eye}
        label="编辑样式"
        onClick={() => handleAction(layerCommands.editStyle)}
      />
      <MenuItem
        icon={FileText}
        label="属性表"
        onClick={() => handleAction(layerCommands.openAttributeTable)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Download}
        label="导出图层"
        onClick={() => handleAction(layerCommands.export)}
      />
      <MenuItem
        icon={Trash2}
        label="移除图层"
        onClick={() => handleAction(layerCommands.remove)}
      />
    </div>
  )
}
