import { MousePointer2 } from 'lucide-react'
import type { EditTool } from '@desktop-webgis/gis-core'
import { useWorkbenchStore } from '@/stores/workbench.store'
import { useProjectStore } from '@/stores/project.store'

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
  return (
    <footer className="status-bar">
      <span className="status-message" role="status" title={message}>
        {message || '就绪'}
      </span>
      <span className="status-item">
        <MousePointer2 size={12} />
        {TOOL_LABELS[tool]}
        {target ? ` · ${target.name}` : ''}
      </span>
      {!!selection.featureIds.length && (
        <span className="status-item">选中 {selection.featureIds.length}</span>
      )}
      <span className="status-item status-coordinate">
        {readout || '移动指针查看坐标'} · EPSG:3857
      </span>
      <span className="status-item">{dirty ? '未保存' : '已保存'}</span>
    </footer>
  )
}
