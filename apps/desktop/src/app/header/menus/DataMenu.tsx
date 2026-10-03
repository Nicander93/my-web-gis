import { Download, Plus, Shapes } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { projectCommands } from '@/app/commands/project.commands'
import { processingCommands } from '@/app/commands/processing.commands'

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
        icon={Shapes}
        label="空间处理…"
        onClick={() => handleAction(processingCommands.open)}
      />
      <MenuItem
        icon={Download}
        label="导出"
        onClick={() => handleAction(projectCommands.exportData)}
      />
    </div>
  )
}
