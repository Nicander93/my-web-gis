import { Pencil, Redo2, Trash2, Undo2 } from 'lucide-react'
import { MenuItem } from './MenuItem'
import { MenuSeparator } from './MenuSeparator'
import { editCommands } from '@/app/commands/edit.commands'
import { getLayerCapabilities } from '@/app/commands/layer.commands'
import { useProjectStore } from '@/stores/project.store'

interface EditMenuProps {
  onClose(): void
}

export function EditMenu({ onClose }: EditMenuProps) {
  useProjectStore(state => state.project)
  const layerId = useProjectStore(state => state.selectedLayerId)
  const caps = getLayerCapabilities(layerId)
  const canUndo = useProjectStore.getState().canUndoEdit()
  const canRedo = useProjectStore.getState().canRedoEdit()
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
        disabled={!canUndo}
        onClick={() => handleAction(editCommands.undo)}
      />
      <MenuItem
        icon={Redo2}
        label="重做"
        shortcut="Ctrl+Shift+Z"
        disabled={!canRedo}
        onClick={() => handleAction(editCommands.redo)}
      />
      <MenuSeparator />
      <MenuItem
        icon={Pencil}
        label="绘制"
        disabled={!caps.canEditGeometry}
        onClick={() => handleAction(editCommands.draw)}
      />
      <MenuItem
        icon={Pencil}
        label="修改几何"
        disabled={!caps.canEditGeometry}
        onClick={() => handleAction(editCommands.modify)}
      />
      <MenuItem
        icon={Trash2}
        label="删除"
        disabled={!caps.canEditGeometry}
        onClick={() => handleAction(editCommands.deleteSelected)}
      />
    </div>
  )
}
