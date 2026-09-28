import { Eye, FileText, Layers2, Maximize2, RotateCcw } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { MenuSeparator } from './MenuSeparator'
import { viewCommands } from '@/app/commands/view.commands'

interface ViewMenuProps {
  onClose(): void
}

export function ViewMenu({ onClose }: ViewMenuProps) {
  function handleAction(action: () => void) {
    action()
    onClose()
  }

  return (
    <div className="menu-content">
      <MenuItem
        icon={Layers2}
        label="图层面板"
        onClick={() => handleAction(viewCommands.toggleLayers)}
      />
      <MenuItem
        icon={Eye}
        label="检查器"
        onClick={() => handleAction(viewCommands.toggleInspector)}
      />
      <MenuItem
        icon={FileText}
        label="属性表"
        onClick={() => handleAction(viewCommands.toggleAttributeTable)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Maximize2}
        label="专注模式"
        shortcut="Ctrl+Shift+F"
        onClick={() => handleAction(viewCommands.toggleFocusMode)}
      />
      <MenuItem
        icon={RotateCcw}
        label="重置布局"
        onClick={() => handleAction(viewCommands.resetLayout)}
      />
    </div>
  )
}
