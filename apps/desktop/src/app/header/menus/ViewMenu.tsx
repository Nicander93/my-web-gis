import { Eye, FileText, Layers2, Maximize2, RotateCcw } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { MenuSeparator } from './MenuSeparator'
import { viewCommands } from '@/app/commands/view.commands'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useProjectStore } from '@/stores/project.store'
import { getProjectType } from '@/services/project-type'

interface ViewMenuProps {
  onClose(): void
}

export function ViewMenu({ onClose }: ViewMenuProps) {
  const layout = useWorkspaceStore()
  const city = useProjectStore(state => getProjectType(state.project) === '3d')
  function handleAction(action: () => void) {
    action()
    onClose()
  }

  return (
    <div className="menu-content">
      <MenuItem
        icon={Layers2}
        label={city ? '场景树' : '图层面板'}
        checked={layout.left.open}
        onClick={() => handleAction(viewCommands.toggleLayers)}
      />
      <MenuItem
        icon={Eye}
        label="检查器"
        checked={layout.right.open}
        onClick={() => handleAction(viewCommands.toggleInspector)}
      />
      <MenuItem
        icon={FileText}
        label="属性表"
        checked={layout.bottom.open}
        disabled={city}
        onClick={() => handleAction(viewCommands.toggleAttributeTable)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Maximize2}
        label="专注模式"
        checked={layout.focusMode}
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
