import { Eye, FileText, Layers2, Maximize2, RotateCcw } from 'lucide-react'
import { MenuItem } from '@/ui/components/MenuItem'
import { MenuSeparator } from '@/ui/components/MenuSeparator'
import { viewCommands } from '@/commands/view.commands'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { useProjectStore } from '@/project/project.store'
import { getProjectType } from '@/project/project-type'
import { useActivityPanelStore } from '@/stores/activity-panel.store'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { requestSceneAction } from '@/ui/panels/scene3d/scene3d-actions'

interface ViewMenuProps {
  onClose(): void
}

export function ViewMenu({ onClose }: ViewMenuProps) {
  const leftOpen = useWorkspaceStore(state => state.left.open)
  const rightOpen = useWorkspaceStore(state => state.right.open)
  const bottomOpen = useWorkspaceStore(state => state.bottom.open)
  const focusMode = useWorkspaceStore(state => state.focusMode)
  const tasksOpen = useActivityPanelStore(state => state.tasksOpen)
  const diagnosticsOpen = useActivityPanelStore(state => state.diagnosticsOpen)
  const is3D = useProjectStore(state => getProjectType(state.project) === '3d')
  const rightTask = useWorkbenchStore(state => state.rightTask)
  function handleAction(action: () => void) {
    action()
    onClose()
  }

  return (
    <div className="menu-content">
      <MenuItem
        icon={Layers2}
        label={is3D ? '场景树' : '图层面板'}
        checked={leftOpen}
        onClick={() => handleAction(viewCommands.toggleLayers)}
      />
      <MenuItem
        icon={Eye}
        label="属性"
        checked={rightOpen && rightTask === 'inspector'}
        onClick={() => handleAction(viewCommands.toggleInspector)}
      />
      {is3D ? <MenuItem icon={Eye} label="场景设置" onClick={() => handleAction(() => requestSceneAction('scene-settings'))} /> : <>
        <MenuItem icon={Eye} label="要素信息" checked={rightOpen && rightTask === 'information'} onClick={() => handleAction(() => viewCommands.toggleRightPanel('information'))} />
        <MenuItem icon={FileText} label="空间处理" checked={rightOpen && rightTask === 'processing'} onClick={() => handleAction(() => viewCommands.toggleRightPanel('processing'))} />
        <MenuItem icon={FileText} label="属性表" checked={bottomOpen} onClick={() => handleAction(viewCommands.toggleAttributeTable)} />
      </>}
      <MenuItem icon={FileText} label="任务中心" checked={tasksOpen} onClick={() => handleAction(viewCommands.openTaskLog)} />
      <MenuItem icon={Eye} label="诊断中心" checked={diagnosticsOpen} onClick={() => handleAction(viewCommands.openDiagnostics)} />
      <MenuSeparator />
      <MenuItem
        icon={Maximize2}
        label="专注模式"
        checked={focusMode}
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
