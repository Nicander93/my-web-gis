import { Eye, FileText, Layers2, Maximize2, RotateCcw } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { MenuSeparator } from './MenuSeparator'
import { viewCommands } from '@/app/commands/view.commands'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useProjectStore } from '@/stores/project.store'
import { getProjectType } from '@/services/project-type'
import { useActivityPanelStore } from '@/stores/activity-panel.store'
import { useWorkbenchStore } from '@/stores/workbench.store'

interface ViewMenuProps {
  onClose(): void
}

export function ViewMenu({ onClose }: ViewMenuProps) {
  const layout = useWorkspaceStore()
  const tasksOpen = useActivityPanelStore(state => state.tasksOpen)
  const diagnosticsOpen = useActivityPanelStore(state => state.diagnosticsOpen)
  const city = useProjectStore(state => getProjectType(state.project) === '3d')
  const rightTask = useWorkbenchStore(state => state.rightTask)
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
        label="属性"
        checked={layout.right.open && (city || rightTask === 'inspector')}
        onClick={() => handleAction(viewCommands.toggleInspector)}
      />
      <MenuItem
        icon={FileText}
        label="属性表"
        checked={layout.bottom.open}
        disabled={city}
        onClick={() => handleAction(viewCommands.toggleAttributeTable)}
      />
      <MenuItem icon={FileText} label="任务中心" checked={tasksOpen} onClick={() => handleAction(viewCommands.openTaskLog)} />
      <MenuItem icon={Eye} label="诊断中心" checked={diagnosticsOpen} onClick={() => handleAction(viewCommands.openDiagnostics)} />
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
