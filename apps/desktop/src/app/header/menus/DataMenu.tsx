import { Download, Plus } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { projectCommands } from '@/app/commands/project.commands'

interface DataMenuProps {
  onClose(): void
}

export function DataMenu({ onClose }: DataMenuProps) {
  function handleAction(action: () => void) {
    action()
    onClose()
  }

  return (
    <div className="menu-content">
      <MenuItem
        icon={Plus}
        label="添加数据"
        onClick={() => handleAction(projectCommands.addData)}
      />
      <MenuItem
        icon={Download}
        label="导出"
        onClick={() => handleAction(projectCommands.exportData)}
      />
    </div>
  )
}
