import { Pencil, Redo2, Trash2, Undo2 } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { MenuSeparator } from './MenuSeparator'
import { editCommands } from '@/app/commands/edit.commands'

interface EditMenuProps {
  onClose(): void
}

export function EditMenu({ onClose }: EditMenuProps) {
  function handleAction(action: () => void) {
    action()
    onClose()
  }

  return (
    <div className="menu-content">
      <MenuItem
        icon={Undo2}
        label="撤销"
        shortcut="Ctrl+Z"
        onClick={() => handleAction(editCommands.undo)}
      />
      <MenuItem
        icon={Redo2}
        label="重做"
        shortcut="Ctrl+Shift+Z"
        onClick={() => handleAction(editCommands.redo)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Pencil}
        label="绘制"
        onClick={() => handleAction(editCommands.draw)}
      />
      <MenuItem
        icon={Pencil}
        label="修改几何"
        onClick={() => handleAction(editCommands.modify)}
      />
      <MenuItem
        icon={Trash2}
        label="删除"
        onClick={() => handleAction(editCommands.deleteSelected)}
      />
    </div>
  )
}
