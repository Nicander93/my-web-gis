import { Download, FileInput, FilePlus2, FolderOpen, Save, X } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { MenuSeparator } from './MenuSeparator'
import { projectCommands } from '@/app/commands/project.commands'

interface ProjectMenuProps {
  onClose(): void
}

export function ProjectMenu({ onClose }: ProjectMenuProps) {
  function handleAction(action: () => void) {
    action()
    onClose()
  }

  return (
    <div className="menu-content">
      <MenuItem
        icon={FilePlus2}
        label="新建"
        shortcut="Ctrl+N"
        onClick={() => handleAction(projectCommands.newProject)}
      />
      <MenuItem
        icon={FolderOpen}
        label="打开"
        shortcut="Ctrl+O"
        onClick={() => handleAction(projectCommands.openProject)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Save}
        label="保存"
        shortcut="Ctrl+S"
        onClick={() => handleAction(projectCommands.saveProject)}
      />
      <MenuItem
        icon={Save}
        label="另存为"
        onClick={() => handleAction(projectCommands.saveProjectAs)}
      />
      <MenuSeparator />
      <MenuItem icon={FileInput} label="导入场景" onClick={() => handleAction(projectCommands.importScene)} />
      {projectCommands.isImportingScene() && <MenuItem icon={X} label="取消场景导入" onClick={() => handleAction(projectCommands.cancelSceneImport)} />}
      <MenuItem icon={Download} label="导出完整场景" onClick={() => handleAction(projectCommands.exportScene)} />
      <MenuItem icon={Download} label="导出场景资源包" onClick={() => handleAction(projectCommands.exportSceneArchive)} />
    </div>
  )
}
