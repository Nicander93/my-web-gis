import { FilePlus2, FolderOpen, Save } from 'lucide-react'
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
    </div>
  )
}
