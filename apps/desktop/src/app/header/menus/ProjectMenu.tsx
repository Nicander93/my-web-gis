import { Download, FileInput, FilePlus2, FolderOpen, Save } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { MenuSeparator } from './MenuSeparator'
import { useProjectStore } from '@/stores/project.store'
import { getProjectType } from '@/services/project-type'
import { requestCityAction } from '@/features/city/city-actions'
import { projectCommands } from '@/app/commands/project.commands'

interface ProjectMenuProps {
  onClose(): void
}

export function ProjectMenu({ onClose }: ProjectMenuProps) {
  const project = useProjectStore(state => state.project)
  const city = getProjectType(project) === '3d'
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
      {city && <><MenuSeparator /><MenuItem icon={FileInput} label="导入场景" onClick={() => handleAction(() => requestCityAction('import-scene'))} /><MenuItem icon={Download} label="导出场景" onClick={() => handleAction(() => requestCityAction('export-scene'))} /></>}
    </div>
  )
}
