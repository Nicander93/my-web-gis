import { MousePointer2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { EditTool } from '@desktop-webgis/gis-core'
import { getActiveEditTool } from '@/features/map/map-runtime-host'

interface StatusBarProps {
  message: string
}

const TOOL_LABELS: Record<EditTool, string> = {
  none: '浏览',
  pan: '平移',
  select: '选择',
  'draw-point': '绘制点',
  'draw-line': '绘制线',
  'draw-polygon': '绘制面',
  modify: '修改',
  delete: '删除'
}

/** 显示应用壳层状态，不写入 Workspace 布局 Store。 */
export function StatusBar({ message }: StatusBarProps) {
  const [tool, setTool] = useState<EditTool>('select')
  useEffect(() => {
    const refresh = () => setTool(getActiveEditTool())
    refresh()
    window.addEventListener('desktop-webgis:command-status', refresh)
    return () => window.removeEventListener('desktop-webgis:command-status', refresh)
  }, [])
  return (
    <footer className="status-bar">
      <span className="status-item"><span className="status-dot" />就绪</span>
      <span className="status-item">EPSG:3857</span>
      <span className="status-item"><MousePointer2 size={12} />{TOOL_LABELS[tool]}</span>
      {message !== '就绪' && <span className="status-message">{message}</span>}
    </footer>
  )
}
