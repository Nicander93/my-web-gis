import {
  LocateFixed,
  MousePointer2,
  Move,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Scan,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { ToolbarButton } from './ToolbarButton'
import { ToolbarSeparator } from './ToolbarSeparator'
import { SnappingControl } from './SnappingControl'
import { projectCommands } from '@/app/commands/project.commands'
import { editCommands } from '@/app/commands/edit.commands'
import { mapCommands } from '@/app/commands/map.commands'
import { useEffect, useState } from 'react'
import { capabilitiesForDataset } from '@desktop-webgis/gis-core'
import { useProjectStore } from '@/stores/project.store'
import { getActiveEditTool } from '@/features/map/map-runtime-host'

export function Toolbar() {
  const project = useProjectStore(state => state.project)
  const selectedLayerId = useProjectStore(state => state.selectedLayerId)
  const selection = useProjectStore(state => state.selection)
  const layer = project.layers.find(item => item.id === selectedLayerId)
  const editable = capabilitiesForDataset(project.datasets.find(item => item.id === layer?.datasetId)).editGeometry
  const canUndo = useProjectStore.getState().canUndoEdit()
  const canRedo = useProjectStore.getState().canRedoEdit()
  const [active, setActive] = useState(getActiveEditTool)
  useEffect(() => {
    const refresh = () => setActive(getActiveEditTool())
    const initialRefresh = window.requestAnimationFrame(refresh)
    window.addEventListener('desktop-webgis:command-status', refresh)
    return () => {
      window.cancelAnimationFrame(initialRefresh)
      window.removeEventListener('desktop-webgis:command-status', refresh)
    }
  }, [project.id])
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
        active={active === 'pan'}
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
        icon={Scan}
        label="全图"
        onClick={mapCommands.zoomToAll}
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
        active={active === 'select'}
        onClick={mapCommands.select}
      />
      <ToolbarButton
        icon={RotateCcw}
        label="清除选择"
        disabled={selection.featureIds.length === 0}
        onClick={mapCommands.clearSelection}
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={Undo2}
        label="撤销"
        disabled={!canUndo}
        onClick={editCommands.undo}
      />
      <ToolbarButton
        icon={Redo2}
        label="重做"
        disabled={!canRedo}
        onClick={editCommands.redo}
      />
      <ToolbarSeparator />
      <ToolbarButton
        icon={Pencil}
        label="绘制"
        disabled={!editable}
        active={active.startsWith('draw-')}
        onClick={editCommands.draw}
      />
      <ToolbarButton
        icon={Pencil}
        label="修改"
        disabled={!editable}
        active={active === 'modify'}
        onClick={editCommands.modify}
      />
      <ToolbarButton
        icon={Trash2}
        label="删除"
        disabled={!editable}
        active={active === 'delete'}
        onClick={editCommands.deleteSelected}
      />
      <ToolbarSeparator />
      <SnappingControl />
    </div>
  )
}
