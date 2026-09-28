import {
  LocateFixed,
  MousePointer2,
  Move,
  Pencil,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { ToolbarButton } from './ToolbarButton'
import { ToolbarSeparator } from './ToolbarSeparator'
import { projectCommands } from '@/app/commands/project.commands'
import { editCommands } from '@/app/commands/edit.commands'
import { mapCommands } from '@/app/commands/map.commands'

export function Toolbar() {
  return (
    <div className="toolbar">
      <ToolbarButton
        icon={Plus}
        label="添加数据"
        onClick={projectCommands.addData}
      />
      <ToolbarButton
        icon={Save}
        label="保存"
        onClick={projectCommands.saveProject}
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={Move}
        label="平移"
        onClick={mapCommands.pan}
      />
      <ToolbarButton
        icon={ZoomIn}
        label="放大"
        onClick={mapCommands.zoomIn}
      />
      <ToolbarButton
        icon={ZoomOut}
        label="缩小"
        onClick={mapCommands.zoomOut}
      />
      <ToolbarButton
        icon={LocateFixed}
        label="定位"
        onClick={mapCommands.locate}
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={MousePointer2}
        label="选择"
        onClick={mapCommands.select}
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={Undo2}
        label="撤销"
        onClick={editCommands.undo}
      />
      <ToolbarButton
        icon={Redo2}
        label="重做"
        onClick={editCommands.redo}
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={Pencil}
        label="绘制"
        onClick={editCommands.draw}
      />
      <ToolbarButton
        icon={Pencil}
        label="修改"
        onClick={editCommands.modify}
      />
      <ToolbarButton
        icon={Trash2}
        label="删除"
        onClick={editCommands.deleteSelected}
      />
    </div>
  )
}
