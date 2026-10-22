import { MousePointer2 } from 'lucide-react'
import type { EditTool } from '@desktop-webgis/gis-core'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useProjectStore } from '@/stores/project.store'
import { MapProjectionControl } from '@/features/map/MapProjectionControl'
import { viewCommands } from './commands/view.commands'
import { useTaskLogStore } from '@/stores/task-log.store'
import { Button } from '@/components/ui/Button'

const TOOL_LABELS: Record<EditTool, string> = {
  none: '浏览',
  pan: '平移',
  select: '选择',
  'draw-point': '绘制点',
  'draw-line': '绘制线',
  'draw-polygon': '绘制面',
  modify: '修改几何',
  delete: '点选删除'
}

/** 状态栏集中显示工作目标和地图读数，消息保留完整内容供悬停查看。 */
export function StatusBar({ message }: { message: string }) {
  const tool = useWorkbenchStore((state) => state.activeTool)
  const readout = useWorkbenchStore((state) => state.mapReadout)
  const editLayerId = useWorkbenchStore((state) => state.editLayerId)
  const project = useProjectStore((state) => state.project)
  const selection = useProjectStore((state) => state.selection)
  const dirty = useProjectStore((state) => state.dirty)
  const target = project.layers.find((layer) => layer.id === editLayerId)
  const epoch = useProjectStore(state => state.projectEpoch)
  const entries = useTaskLogStore(state => state.entries)
  const running = entries.filter(entry => entry.projectEpoch === epoch && entry.status === 'running').length
  const identify = useWorkbenchStore(state => state.identifyActive)
  return (
    <footer className="status-bar">
      <span className="status-message" role="status" title={message}>
        {message || '就绪'}
      </span>
      <span className="status-item">
        <MousePointer2 size={12} />
        {identify ? '识别' : TOOL_LABELS[tool]}
        {target ? ` · ${target.name}` : ''}
      </span>
      {!!selection.featureIds.length && (
        <span className="status-item">选中 {selection.featureIds.length}</span>
      )}
      <span className="status-item status-coordinate">
        {readout || '移动指针查看坐标'}
      </span>
      <MapProjectionControl />
      <Button variant="ghost" onClick={viewCommands.openTaskLog} title="打开任务中心">任务{running ? ` ${running}` : ''}</Button>
      <Button variant="ghost" onClick={viewCommands.openDiagnostics} title="打开诊断中心">诊断</Button>
      <span className="status-item">{dirty ? '未保存' : '已保存'}</span>
    </footer>
  )
}
