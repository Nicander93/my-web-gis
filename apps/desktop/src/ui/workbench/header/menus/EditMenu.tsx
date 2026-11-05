import { useEditHistory } from '@/project/project-edits'
import { useLayerViewStore } from '@/stores/layer-view.store'
import { Pencil, Redo2, Trash2, Undo2 } from 'lucide-react'
import { MenuItem } from '@/ui/components/MenuItem'
import { MenuSeparator } from '@/ui/components/MenuSeparator'
import { editCommands } from '@/commands/edit.commands'
import { getLayerCapabilities } from '@/commands/layer.commands'
import { useProjectStore } from '@/project/project.store'

interface EditMenuProps {
  onClose(): void
}

export function EditMenu({ onClose }: EditMenuProps) {
  useProjectStore(state => state.project)
  const layerId = useLayerViewStore(state => state.selectedLayerId)
  const caps = getLayerCapabilities(layerId)
  const { canUndo, canRedo } = useEditHistory()
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
