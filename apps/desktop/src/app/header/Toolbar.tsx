import { LocateFixed, MousePointer2, Move, Pencil, Redo2, RotateCcw, Save, Scan, Shapes, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { capabilitiesForDataset } from '@desktop-webgis/gis-core'
import { ToolbarButton } from './ToolbarButton'
import { SnappingControl } from './SnappingControl'
import { WorkbenchRibbon, type RibbonCommand } from './WorkbenchRibbon'
import { ViewMenu } from './menus/ViewMenu'
import { MenuItem } from './menus/MenuItem'
import { projectCommands } from '@/app/commands/project.commands'
import { processingCommands } from '@/app/commands/processing.commands'
import { editCommands } from '@/app/commands/edit.commands'
import { mapCommands } from '@/app/commands/map.commands'
import { useProjectStore } from '@/stores/project.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { getActiveEditTool } from '@/features/map/map-runtime-host'

/** 2D commands adapt to the same compact ribbon as the scene editor. */
export function Toolbar() {
  const project = useProjectStore(state => state.project)
  const selectedLayerId = useProjectStore(state => state.selectedLayerId)
  const targetId = useProjectStore(state => state.activeEditLayerId)
  const selection = useProjectStore(state => state.selection)
  const category = useWorkspaceStore(state => state.ribbonCategory)
  const layer = project.layers.find(item => item.id === (targetId ?? selectedLayerId))
  const editable = capabilitiesForDataset(project.datasets.find(item => item.id === layer?.datasetId)).editGeometry
  const [active, setActive] = useState(getActiveEditTool)
  const [, setRevision] = useState(0)
  useEffect(() => {
    const refresh = () => { setActive(getActiveEditTool()); setRevision(value => value + 1) }
    const initial = window.requestAnimationFrame(refresh)
    window.addEventListener('desktop-webgis:command-status', refresh)
    return () => { window.cancelAnimationFrame(initial); window.removeEventListener('desktop-webgis:command-status', refresh) }
  }, [project.id])
  // History changes may leave dirty=true; command-status also triggers a render.
  const store = useProjectStore.getState()
  const reason = editable ? undefined : '请选择可编辑的本地图层'
  const edit: RibbonCommand[] = [
    { id:'select', label:'选择', icon:MousePointer2, execute:mapCommands.select, active:active === 'select' },
    { id:'clear', label:'清除选择', icon:RotateCcw, execute:mapCommands.clearSelection, disabled:selection.featureIds.length ? undefined : '未选择要素' },
    { id:'draw', label:'绘制', icon:Pencil, execute:editCommands.draw, disabled:reason, active:active.startsWith('draw-') },
    { id:'modify', label:'修改', icon:Pencil, execute:editCommands.modify, disabled:reason, active:active === 'modify' },
    { id:'delete', label:'删除', icon:Trash2, execute:editCommands.deleteSelected, disabled:reason, active:active === 'delete' }
  ]
  const map: RibbonCommand[] = [
    { id:'pan', label:'平移', icon:Move, execute:mapCommands.pan, active:active === 'pan' },
    { id:'in', label:'放大', icon:ZoomIn, execute:mapCommands.zoomIn },
    { id:'out', label:'缩小', icon:ZoomOut, execute:mapCommands.zoomOut },
    { id:'all', label:'全图', icon:Scan, execute:mapCommands.zoomToAll },
    { id:'locate', label:'定位', icon:LocateFixed, execute:mapCommands.locate }
  ]
  return <WorkbenchRibbon categories={[{ id:'edit', label:'编辑', commands:edit },{ id:'map', label:'地图', commands:map }]} onAdd={projectCommands.addData}
    target={category === 'map' ? undefined : `编辑目标：${editable ? layer?.name : '未设置'}${editable && !targetId ? '（启动编辑后固定）' : ''}`}
    quickActions={<><ToolbarButton icon={Undo2} label="撤销" disabled={!store.canUndoEdit()} onClick={editCommands.undo} /><ToolbarButton icon={Redo2} label="重做" disabled={!store.canRedoEdit()} onClick={editCommands.redo} /><ToolbarButton icon={Save} label="保存项目" onClick={projectCommands.saveProject} /></>}
    extraTools={category === 'map' ? undefined : <SnappingControl />}
    more={<><ViewMenu onClose={() => {}} /><MenuItem icon={Shapes} label="空间处理…" onClick={processingCommands.open} /></>} />
}
